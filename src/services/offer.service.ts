import { randomBytes } from 'crypto';
import type { Prisma, SwapOffer, User } from '@prisma/client';
import { prisma } from '@/config/database';
import type { AuthUser } from '@/types/express';
import type { CreateOfferRequest, OfferDto, OfferSearchQuery, UpdateOfferRequest } from '@/contracts';
import { effectivePlan } from '@/lib/entitlements';
import { bucketDistanceKm, fromGeoPoint, haversineKm, toGeoPoint, toPublicArea } from '@/lib/geo';
import { convertMinor, deviationBps, impliedRate, isConsistentTriple, MoneyError, rateToScaled, toMinor } from '@/lib/money';
import { toOfferDto } from '@/presenters/offer.presenter';
import { completionRate } from '@/presenters/user.presenter';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, RateMismatchError, ValidationError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { currencyService } from './currency.service';
import { exchangeRateService } from './exchangeRate.service';
import { limitService } from './limit.service';
import { disputeRateOf, matchingService, scoreOffer } from './matching.service';
import { promotionService } from './promotion.service';
import { riskService } from './risk.service';
import { systemConfig } from './system-config.service';
import { logActivity } from './activity.service';

type OfferWithOwner = SwapOffer & { user: User };
const MAX_CANDIDATES = 300;

const parseAmount = (value: string, minorUnit: number, label: string): bigint => {
  try {
    return toMinor(value, minorUnit);
  } catch (e) {
    if (e instanceof MoneyError) throw new ValidationError(e.message, [{ field: label, message: e.message }]);
    throw e;
  }
};

export class OfferService {
  // ───────────── create / update ─────────────

  async create(userId: string, input: CreateOfferRequest): Promise<OfferDto> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await riskService.assertCanTrade(user);
    await limitService.assertCanCreateOffer(userId);

    const [have, want] = await Promise.all([currencyService.assertActive(input.haveCurrency), currencyService.assertActive(input.wantCurrency)]);
    if (have.code === want.code) throw new BadRequestError('Currencies must differ');

    const haveMinor = parseAmount(input.haveAmount, have.minorUnit, 'haveAmount');
    if (haveMinor <= 0n) throw new ValidationError('haveAmount must be greater than zero');

    const rateScaled = await this.resolveRate({ have: have.code, want: want.code, haveMinor, haveUnit: have.minorUnit, wantUnit: want.minorUnit, wantAmount: input.wantAmount, rate: input.exchangeRate });

    const minSwapMinor = input.minSwapAmount ? parseAmount(input.minSwapAmount, have.minorUnit, 'minSwapAmount') : 0n;
    if (minSwapMinor > haveMinor) throw new ValidationError('minSwapAmount cannot exceed haveAmount');

    const from = new Date(input.availableFrom);
    const until = new Date(input.availableUntil);
    await this.assertWindow(from, until);

    const exact = { latitude: input.latitude, longitude: input.longitude };
    const id = randomBytes(12).toString('hex');

    const offer = await prisma.swapOffer.create({
      data: {
        id, userId,
        haveCurrency: have.code, wantCurrency: want.code,
        haveTotalMinor: haveMinor, remainingMinor: haveMinor, reservedMinor: 0n, consumedMinor: 0n,
        rateScaled, minSwapMinor,
        country: input.country, city: input.city, state: input.state,
        privateLocation: toGeoPoint(exact),
        area: toPublicArea(exact, id),
        areaLabel: input.meetingArea ?? null,
        radiusKm: input.radiusKm,
        meetingArea: input.meetingArea,
        availableFrom: from, availableUntil: until, expiresAt: until,
        timeSlots: input.timeSlots,
        visibility: input.visibility,
        notes: input.notes,
        requiresVerifiedUsers: input.requiresVerifiedUsers,
        minTrustScore: input.minTrustScore,
      },
    });
    await logActivity(userId, 'OFFER_CREATED', `Offer ${have.code}→${want.code} created`, { offerId: offer.id });
    void riskService.onOfferLocation(userId, input.country).catch(() => undefined);
    void matchingService.notifyMatchesForOffer(offer);
    return toOfferDto(offer, user, { viewerId: userId, units: await currencyService.unitMap() });
  }

  /** The server decides the rate; a client-supplied triple must agree with it. */
  async resolveRate(p: { have: string; want: string; haveMinor: bigint; haveUnit: number; wantUnit: number; wantAmount?: string; rate?: string }): Promise<bigint> {
    let rateScaled: bigint;
    const wantMinor = p.wantAmount !== undefined ? parseAmount(p.wantAmount, p.wantUnit, 'wantAmount') : undefined;

    if (p.rate !== undefined) {
      try {
        rateScaled = rateToScaled(p.rate);
      } catch (e) {
        throw new ValidationError((e as Error).message, [{ field: 'exchangeRate', message: (e as Error).message }]);
      }
      if (wantMinor !== undefined && !isConsistentTriple(p.haveMinor, wantMinor, rateScaled, p.haveUnit, p.wantUnit)) {
        throw new RateMismatchError('haveAmount, wantAmount and exchangeRate do not agree');
      }
    } else if (wantMinor !== undefined) {
      rateScaled = impliedRate(p.haveMinor, wantMinor, p.haveUnit, p.wantUnit);
    } else {
      rateScaled = (await exchangeRateService.getRateScaled(p.have, p.want)).rateScaled;
    }

    // Reject rates wildly off the market (typos, scams, stale clients).
    try {
      const ref = await exchangeRateService.getRateScaled(p.have, p.want);
      const maxBps = BigInt(await systemConfig.getInt('offer.maxRateDeviationBps'));
      if (deviationBps(rateScaled, ref.rateScaled) > maxBps) {
        throw new RateMismatchError('The rate is too far from the current market rate');
      }
    } catch (e) {
      if (e instanceof RateMismatchError) throw e;
      logger.warn('reference rate unavailable; skipped deviation check', { pair: `${p.have}/${p.want}` });
    }
    return rateScaled;
  }

  private async assertWindow(from: Date, until: Date): Promise<void> {
    if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime())) throw new ValidationError('Invalid availability window');
    if (until <= from) throw new ValidationError('availableUntil must be after availableFrom');
    if (until <= new Date()) throw new ValidationError('availableUntil must be in the future');
    const horizon = await systemConfig.getInt('offer.maxHorizonDays');
    if (until.getTime() > Date.now() + horizon * 86_400_000) throw new ValidationError(`Offers can be listed for at most ${horizon} days`);
  }

  async update(userId: string, id: string, input: UpdateOfferRequest): Promise<OfferDto> {
    const offer = await prisma.swapOffer.findFirst({ where: { id, userId }, include: { user: true } });
    if (!offer) throw new NotFoundError('Offer not found');
    if (!['ACTIVE', 'PAUSED'].includes(offer.status)) throw new ConflictError('This offer can no longer be edited');

    const [have, want] = await Promise.all([currencyService.get(offer.haveCurrency), currencyService.get(offer.wantCurrency)]);
    const data: Prisma.SwapOfferUpdateManyMutationInput = {};

    if (input.exchangeRate !== undefined) {
      data.rateScaled = await this.resolveRate({ have: have.code, want: want.code, haveMinor: offer.haveTotalMinor, haveUnit: have.minorUnit, wantUnit: want.minorUnit, rate: input.exchangeRate });
    }
    if (input.minSwapAmount !== undefined) {
      const m = parseAmount(input.minSwapAmount, have.minorUnit, 'minSwapAmount');
      if (m > offer.haveTotalMinor) throw new ValidationError('minSwapAmount cannot exceed the offer size');
      data.minSwapMinor = m;
    }
    const from = input.availableFrom ? new Date(input.availableFrom) : offer.availableFrom;
    const until = input.availableUntil ? new Date(input.availableUntil) : offer.availableUntil;
    if (input.availableFrom || input.availableUntil) {
      await this.assertWindow(from, until);
      data.availableFrom = from;
      data.availableUntil = until;
      data.expiresAt = until;
    }
    if (input.meetingArea !== undefined) { data.meetingArea = input.meetingArea; data.areaLabel = input.meetingArea; }
    if (input.timeSlots !== undefined) data.timeSlots = input.timeSlots;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.visibility !== undefined) data.visibility = input.visibility;
    if (input.requiresVerifiedUsers !== undefined) data.requiresVerifiedUsers = input.requiresVerifiedUsers;
    if (input.minTrustScore !== undefined) data.minTrustScore = input.minTrustScore;
    if (input.radiusKm !== undefined) data.radiusKm = input.radiusKm;

    const r = await prisma.swapOffer.updateMany({ where: { id, userId, status: { in: ['ACTIVE', 'PAUSED'] } }, data });
    if (r.count !== 1) throw new ConflictError('This offer can no longer be edited');
    await logActivity(userId, 'OFFER_UPDATED', 'Offer updated', { offerId: id });
    return this.getById(id, { userId } as AuthUser);
  }

  async setPaused(userId: string, id: string, paused: boolean) {
    const r = await prisma.swapOffer.updateMany({
      where: paused ? { id, userId, status: 'ACTIVE' } : { id, userId, status: 'PAUSED', availableUntil: { gt: new Date() } },
      data: { status: paused ? 'PAUSED' : 'ACTIVE' },
    });
    if (r.count !== 1) throw new ConflictError('The offer state does not allow this');
  }

  /** Cannot cancel while a swap holds part of it; the owner must resolve those swaps first. */
  async cancel(userId: string, id: string) {
    const r = await prisma.swapOffer.updateMany({ where: { id, userId, status: { in: ['ACTIVE', 'PAUSED'] }, reservedMinor: 0n }, data: { status: 'CANCELLED' } });
    if (r.count !== 1) {
      const o = await prisma.swapOffer.findFirst({ where: { id, userId } });
      if (!o) throw new NotFoundError('Offer not found');
      if (o.reservedMinor > 0n) throw new ConflictError('This offer has swaps in progress. Resolve them first.');
      throw new ConflictError('The offer is already closed');
    }
    await logActivity(userId, 'OFFER_DELETED', 'Offer cancelled', { offerId: id });
  }

  // ───────────── reads ─────────────

  async getById(id: string, viewer?: Pick<AuthUser, 'userId'> & Partial<AuthUser>): Promise<OfferDto> {
    const offer = await prisma.swapOffer.findUnique({ where: { id }, include: { user: true } });
    if (!offer) throw new NotFoundError('Offer not found');
    const mine = viewer?.userId === offer.userId;
    if (!mine) {
      if (offer.visibility === 'PRIVATE') {
        const involved = viewer?.userId ? await prisma.swap.count({ where: { offerId: id, OR: [{ initiatorId: viewer.userId }, { receiverId: viewer.userId }] } }) : 0;
        if (!involved) throw new NotFoundError('Offer not found');
      }
      if (offer.status !== 'ACTIVE') {
        const involved = viewer?.userId ? await prisma.swap.count({ where: { offerId: id, initiatorId: viewer.userId } }) : 0;
        if (!involved) throw new NotFoundError('Offer not found');
      }
      if (viewer?.userId && (await this.isBlockedEitherWay(viewer.userId, offer.userId))) throw new NotFoundError('Offer not found');
      void prisma.swapOffer.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => undefined);
      if (offer.boostedUntil && offer.boostedUntil > new Date()) {
        const b = await prisma.boost.findFirst({ where: { offerId: id, status: 'ACTIVE' }, select: { id: true } });
        if (b) void promotionService.recordClick('BOOST', b.id);
      }
    }
    return toOfferDto(offer, offer.user, { viewerId: viewer?.userId, units: await currencyService.unitMap() });
  }

  async mine(userId: string, status: string | undefined, page: number, perPage: number) {
    const where: Prisma.SwapOfferWhereInput = { userId, ...(status ? { status: status as SwapOffer['status'] } : {}) };
    const [rows, total] = await Promise.all([
      prisma.swapOffer.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      prisma.swapOffer.count({ where }),
    ]);
    const units = await currencyService.unitMap();
    return { items: rows.map((o) => toOfferDto(o, o.user, { viewerId: userId, units })), total };
  }

  private async blockedIds(viewerId: string): Promise<string[]> {
    const rows = await prisma.blockedUser.findMany({ where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] }, select: { blockerId: true, blockedId: true } });
    return [...new Set(rows.map((r) => (r.blockerId === viewerId ? r.blockedId : r.blockerId)))];
  }
  private async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    return (await prisma.blockedUser.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })) > 0;
  }

  /** Candidate ids + exact-distance via MongoDB $geoNear on the *public* area index. */
  private async geoCandidates(lat: number, lng: number, radiusKm: number): Promise<Map<string, number>> {
    const docs = (await prisma.swapOffer.aggregateRaw({
      pipeline: [
        { $geoNear: { near: { type: 'Point', coordinates: [lng, lat] }, distanceField: 'dist', maxDistance: radiusKm * 1000, spherical: true, key: 'area', query: { status: 'ACTIVE' } } },
        { $limit: MAX_CANDIDATES },
        { $project: { _id: 1, dist: 1 } },
      ],
    })) as unknown as { _id: { $oid: string }; dist: number }[];
    return new Map(docs.map((d) => [d._id.$oid, d.dist / 1000]));
  }

  async search(q: OfferSearchQuery, viewer?: AuthUser) {
    const now = new Date();
    const and: Prisma.SwapOfferWhereInput[] = [];
    const where: Prisma.SwapOfferWhereInput = { status: 'ACTIVE', availableUntil: { gt: now }, remainingMinor: { gt: 0n }, AND: and };

    if (q.haveCurrency) where.haveCurrency = q.haveCurrency;
    if (q.wantCurrency) where.wantCurrency = q.wantCurrency;
    if (q.country) where.country = q.country;
    if (q.city) where.city = { equals: q.city, mode: 'insensitive' };
    if (q.availableNow) where.availableFrom = { lte: now };

    let requestedMinor: bigint | null = null;
    if (q.haveCurrency && (q.minAmount || q.maxAmount)) {
      const unit = await currencyService.minorUnit(q.haveCurrency);
      const range: { gte?: bigint; lte?: bigint } = {};
      if (q.minAmount) { range.gte = parseAmount(q.minAmount, unit, 'minAmount'); requestedMinor = range.gte; }
      if (q.maxAmount) range.lte = parseAmount(q.maxAmount, unit, 'maxAmount');
      and.push({ remainingMinor: range });
    }

    const viewerUser = viewer ? await prisma.user.findUnique({ where: { id: viewer.userId } }) : null;
    const verified = !!viewerUser && viewerUser.idVerified && viewerUser.verificationStatus === 'VERIFIED';
    const premium = viewerUser ? effectivePlan(viewerUser) !== 'FREE' : false;
    const vis: Prisma.SwapOfferWhereInput[] = [{ visibility: 'PUBLIC' }];
    if (verified) vis.push({ visibility: 'VERIFIED_ONLY' });
    if (premium) vis.push({ visibility: 'PREMIUM_ONLY' });
    and.push({ OR: vis });
    if (!verified) and.push({ requiresVerifiedUsers: false });
    if (viewerUser) {
      and.push({ userId: { not: viewerUser.id } });
      const blocked = await this.blockedIds(viewerUser.id);
      if (blocked.length) and.push({ userId: { notIn: blocked } });
      and.push({ minTrustScore: { lte: viewerUser.trustScore } });
    } else {
      and.push({ requiresVerifiedUsers: false }, { minTrustScore: 0 });
    }
    const ownerFilter: Prisma.UserWhereInput = { isActive: true, isBanned: false, deletedAt: null, tradingRestricted: false };
    if (q.verifiedOnly) { ownerFilter.idVerified = true; ownerFilter.verificationStatus = 'VERIFIED'; }
    if (q.minTrustScore) ownerFilter.trustScore = { gte: q.minTrustScore };
    and.push({ user: ownerFilter });

    let distances = new Map<string, number>();
    const hasGeo = q.latitude !== undefined && q.longitude !== undefined;
    if (hasGeo) {
      distances = await this.geoCandidates(q.latitude!, q.longitude!, q.radiusKm ?? 25);
      and.push({ id: { in: [...distances.keys()] } });
    }

    const rows = (await prisma.swapOffer.findMany({ where, include: { user: true }, orderBy: { createdAt: 'desc' }, take: MAX_CANDIDATES })) as OfferWithOwner[];

    // Reference rates per pair (cached for this request).
    const refs = new Map<string, bigint | null>();
    const refFor = async (a: string, b: string) => {
      const k = `${a}/${b}`;
      if (!refs.has(k)) refs.set(k, await exchangeRateService.getRateScaled(a, b).then((r) => r.rateScaled).catch(() => null));
      return refs.get(k)!;
    };

    const scored = [] as { o: OfferWithOwner; score: number; km: number | null }[];
    for (const o of rows) {
      const km = distances.get(o.id) ?? null;
      const ref = await refFor(o.haveCurrency, o.wantCurrency);
      const advantage = ref ? Number(((ref - o.rateScaled) * 10_000n) / ref) / 10_000 : null;
      const s = scoreOffer({
        amountFit: requestedMinor && requestedMinor > 0n ? Math.min(1, Number((o.remainingMinor * 1000n) / requestedMinor) / 1000) : 1,
        rateAdvantage: advantage,
        distanceKm: km,
        radiusKm: o.radiusKm,
        availableNow: o.availableFrom <= now,
        ownerVerified: o.user.idVerified && o.user.verificationStatus === 'VERIFIED',
        trustScore: o.user.trustScore,
        completionRate: completionRate(o.user),
        responseRate: o.user.responseRate,
        disputeRate: disputeRateOf(o.user),
        meetupPreferenceMatch: !!viewerUser && o.user.preferredMeetingPlaces.some((p) => viewerUser.preferredMeetingPlaces.includes(p)),
        ageHours: (now.getTime() - o.createdAt.getTime()) / 3_600_000,
        boosted: !!o.boostedUntil && o.boostedUntil > now,
        featured: !!o.featuredUntil && o.featuredUntil > now,
      });
      scored.push({ o, score: s.total, km });
    }

    switch (q.sortBy) {
      case 'rate': scored.sort((a, b) => (a.o.rateScaled < b.o.rateScaled ? -1 : a.o.rateScaled > b.o.rateScaled ? 1 : 0)); break;
      case 'distance': scored.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity)); break;
      case 'newest': scored.sort((a, b) => b.o.createdAt.getTime() - a.o.createdAt.getTime()); break;
      case 'amount': scored.sort((a, b) => (a.o.remainingMinor < b.o.remainingMinor ? 1 : -1)); break;
      default: scored.sort((a, b) => b.score - a.score || b.o.createdAt.getTime() - a.o.createdAt.getTime());
    }

    const total = scored.length;
    const pageItems = scored.slice((q.page - 1) * q.perPage, q.page * q.perPage);
    const units = await currencyService.unitMap();
    const boostedIds = pageItems.filter((x) => x.o.boostedUntil && x.o.boostedUntil > now).map((x) => x.o.id);
    if (boostedIds.length) {
      const boosts = await prisma.boost.findMany({ where: { offerId: { in: boostedIds }, status: 'ACTIVE' }, select: { id: true } });
      void promotionService.recordImpressions('BOOST', boosts.map((b) => b.id));
    }
    return {
      total,
      items: pageItems.map(({ o, km }) => toOfferDto(o, o.user, { viewerId: viewer?.userId, units, distanceKm: km === null ? undefined : bucketDistanceKm(km) })),
    };
  }

  /** Dedicated paid discovery placement (separate from Boost ranking). Always labelled. */
  async featured(placement: 'HOMEPAGE' | 'MARKETPLACE_TOP' | 'CURRENCY_PAIR', viewer?: AuthUser, pair?: { have?: string; want?: string }) {
    const listings = await promotionService.activeFeatured(placement, 12);
    if (!listings.length) return [];
    const offers = (await prisma.swapOffer.findMany({
      where: { id: { in: listings.map((l) => l.offerId) }, status: 'ACTIVE', availableUntil: { gt: new Date() }, remainingMinor: { gt: 0n }, visibility: 'PUBLIC', ...(pair?.have ? { haveCurrency: pair.have } : {}), ...(pair?.want ? { wantCurrency: pair.want } : {}) },
      include: { user: true },
    })) as OfferWithOwner[];
    const units = await currencyService.unitMap();
    void promotionService.recordImpressions('FEATURED', listings.map((l) => l.id));
    return offers.slice(0, 6).map((o) => toOfferDto(o, o.user, { viewerId: viewer?.userId, units, sponsored: true }));
  }

  // ───────────── jobs ─────────────

  /** Expired offers are also rejected at read/reserve time, so a late job never exposes stale inventory. */
  async expireElapsed(now = new Date()): Promise<number> {
    const r = await prisma.swapOffer.updateMany({ where: { status: { in: ['ACTIVE', 'PAUSED'] }, availableUntil: { lte: now }, reservedMinor: 0n }, data: { status: 'EXPIRED' } });
    return r.count;
  }

  async notifyExpiringSoon(now = new Date()): Promise<number> {
    const { notificationService } = await import('./notification.service');
    const soon = new Date(now.getTime() + 6 * 3600_000);
    const rows = await prisma.swapOffer.findMany({ where: { status: 'ACTIVE', availableUntil: { gt: now, lte: soon } }, take: 300 });
    for (const o of rows) await notificationService.notify({ userId: o.userId, type: 'OFFER_EXPIRING', entityId: o.id, params: { pair: `${o.haveCurrency}/${o.wantCurrency}` }, dedupeKey: `offer-expiring:${o.id}` });
    return rows.length;
  }

  owns(offer: SwapOffer, userId: string) {
    if (offer.userId !== userId) throw new ForbiddenError();
  }
  convertForOffer(offer: SwapOffer, haveMinor: bigint, haveUnit: number, wantUnit: number) {
    return convertMinor(haveMinor, haveUnit, wantUnit, offer.rateScaled);
  }
  distanceBetween(a: { coordinates: number[] }, b: { coordinates: number[] }) {
    const x = fromGeoPoint(a);
    const y = fromGeoPoint(b);
    return x && y ? haversineKm(x, y) : null;
  }
}

export const offerService = new OfferService();
