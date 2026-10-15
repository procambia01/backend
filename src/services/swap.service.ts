import { randomBytes } from 'crypto';
import type { Meetup, Prisma, Swap, SwapCancelCode, SwapEventType, SwapStatus, User } from '@prisma/client';
import { prisma } from '@/config/database';
import type { CreateSwapRequest, SwapDto, SwapEventDto } from '@/contracts';
import { actorMayTransition, assertTransition, canTransition, IllegalSwapTransitionError, SwapActorRole } from '@/domain/swap-state';
import { effectivePlan } from '@/lib/entitlements';
import { convertMinor, MoneyError, toMinor } from '@/lib/money';
import { roleOf, toSwapDto } from '@/presenters/swap.presenter';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  OfferUnavailableError,
  ValidationError,
  VerificationRequiredError,
} from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { logActivity } from './activity.service';
import { currencyService } from './currency.service';
import { limitService } from './limit.service';
import { marketService } from './market.service';
import { notificationService } from './notification.service';
import { ratingService } from './rating.service';
import { referralService } from './referral.service';
import { reservationService } from './reservation.service';
import { riskService } from './risk.service';
import { systemConfig } from './system-config.service';

const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';
const first = (name: string) => name.split(' ')[0];
const hours = (h: number) => h * 3_600_000;

export interface Actor {
  userId: string | null;
  role: SwapActorRole;
}

export class SwapService {
  // ───────────── events ─────────────

  /**
   * Appends an immutable SwapEvent. With an explicit `dedupeKey` the event is
   * also an idempotency claim: returns false when someone already recorded it.
   */
  async record(
    swapId: string,
    eventType: SwapEventType,
    o: { actorId?: string | null; previous?: SwapStatus | null; next?: SwapStatus | null; metadata?: Record<string, unknown>; dedupeKey?: string } = {}
  ): Promise<boolean> {
    try {
      await prisma.swapEvent.create({
        data: {
          swapId, eventType, actorId: o.actorId ?? null, previousStatus: o.previous ?? null, newStatus: o.next ?? null,
          metadata: (o.metadata ?? {}) as Prisma.InputJsonValue,
          dedupeKey: o.dedupeKey ?? `${eventType}:${swapId}:${randomBytes(6).toString('hex')}`,
        },
      });
      return true;
    } catch (e) {
      if (isUnique(e)) return false;
      throw e;
    }
  }

  // ───────────── creation ─────────────

  /**
   * Requests part (or all) of an offer. Terms are computed on the server from
   * the offer; amount/rate in the request body are never trusted.
   */
  async create(initiatorId: string, input: CreateSwapRequest): Promise<SwapDto> {
    const initiator = await prisma.user.findUniqueOrThrow({ where: { id: initiatorId } });
    await this.assertMayTrade(initiator);

    const offer = await prisma.swapOffer.findUnique({ where: { id: input.offerId }, include: { user: true } });
    if (!offer || offer.status !== 'ACTIVE' || offer.availableUntil <= new Date()) throw new OfferUnavailableError();
    if (offer.userId === initiatorId) throw new BadRequestError('You cannot swap with your own offer');
    const owner = offer.user;
    if (!owner.isActive || owner.isBanned || owner.tradingRestricted || owner.deletedAt) throw new OfferUnavailableError();
    if ((await prisma.blockedUser.count({ where: { OR: [{ blockerId: initiatorId, blockedId: owner.id }, { blockerId: owner.id, blockedId: initiatorId }] } })) > 0) {
      throw new OfferUnavailableError();
    }

    const verified = initiator.idVerified && initiator.verificationStatus === 'VERIFIED';
    if (offer.visibility === 'PRIVATE') throw new OfferUnavailableError();
    if (offer.visibility === 'VERIFIED_ONLY' && !verified) throw new VerificationRequiredError('This offer is open to verified users only');
    if (offer.visibility === 'PREMIUM_ONLY' && effectivePlan(initiator) === 'FREE') throw new ForbiddenError('This offer is open to Premium members only');
    if (offer.requiresVerifiedUsers && !verified) throw new VerificationRequiredError('The owner only trades with verified users');
    if (initiator.trustScore < offer.minTrustScore) throw new ForbiddenError('Your trust score is below this offer’s requirement');

    const [have, want] = await Promise.all([currencyService.get(offer.haveCurrency), currencyService.get(offer.wantCurrency)]);
    if (!have.isActive || !want.isActive) throw new OfferUnavailableError('One of the currencies is no longer supported');

    let haveMinor: bigint;
    try {
      haveMinor = toMinor(input.haveAmount, have.minorUnit);
    } catch (e) {
      if (e instanceof MoneyError) throw new ValidationError(e.message, [{ field: 'haveAmount', message: e.message }]);
      throw e;
    }
    if (haveMinor <= 0n) throw new ValidationError('haveAmount must be greater than zero');
    if (haveMinor < offer.minSwapMinor) throw new ValidationError('The amount is below this offer’s minimum');
    // Terms are derived here, from the offer's rate, with exact integer maths.
    const wantMinor = convertMinor(haveMinor, have.minorUnit, want.minorUnit, offer.rateScaled);
    if (wantMinor <= 0n) throw new ValidationError('The amount is too small to exchange');

    await limitService.assertCanStartSwap(initiatorId);
    await limitService.assertSwapAllowed(initiatorId, have.code, haveMinor);
    await riskService.evaluateSwapRequest(initiator, have.code, haveMinor);

    const ttl = await systemConfig.getInt('swap.pendingTtlHours');
    const expiresAt = new Date(Date.now() + hours(ttl));
    const swapId = randomBytes(12).toString('hex');

    // 1. Atomic reservation: fails cleanly if someone else took the slice.
    await reservationService.reserve(offer.id, haveMinor);
    let swap: Swap;
    try {
      swap = await prisma.swap.create({
        data: {
          id: swapId, initiatorId, receiverId: owner.id, offerId: offer.id,
          haveCurrency: have.code, wantCurrency: want.code,
          requestedHaveMinor: haveMinor, requestedWantMinor: wantMinor, requestedRateScaled: offer.rateScaled,
          expiresAt,
        },
      });
      await reservationService.hold(offer.id, swap.id, haveMinor, expiresAt);
    } catch (error) {
      // Never leave inventory stuck if the swap could not be recorded.
      await prisma.swap.deleteMany({ where: { id: swapId } }).catch(() => undefined);
      await reservationService.unreserve(offer.id, haveMinor).catch(() => undefined);
      throw error;
    }

    await this.record(swap.id, 'CREATED', { actorId: initiatorId, next: 'PENDING', metadata: { haveMinor: haveMinor.toString() }, dedupeKey: `CREATED:${swap.id}` });
    await this.record(swap.id, 'RESERVATION_HELD', { actorId: null, dedupeKey: `RESERVATION_HELD:${swap.id}` });
    if (input.message) {
      const { messageService } = await import('./message.service');
      await messageService.createSystemOrFirst(swap.id, initiatorId, input.message).catch(() => undefined);
    }
    await logActivity(initiatorId, 'SWAP_INITIATED', `Swap requested ${have.code}→${want.code}`, { swapId: swap.id });
    await notificationService.notify({
      userId: owner.id, type: 'SWAP_REQUEST', entityId: swap.id,
      params: { name: first(initiator.name), amount: `${input.haveAmount} ${have.code}` }, dedupeKey: `swap:${swap.id}:request`,
    });
    return this.getForUser(initiatorId, swap.id);
  }

  private async assertMayTrade(user: User): Promise<void> {
    await riskService.assertCanTrade(user);
    if (!user.emailVerified) throw new VerificationRequiredError('Please verify your email address first');
    if ((await systemConfig.getBool('swap.requirePhone')) && !user.phoneVerified) throw new VerificationRequiredError('Please verify your phone number first');
  }

  // ───────────── loading ─────────────

  private async load(swapId: string, userId: string): Promise<{ swap: Swap; role: 'INITIATOR' | 'RECEIVER' }> {
    const swap = await prisma.swap.findUnique({ where: { id: swapId } });
    const role = swap ? roleOf(swap, userId) : null;
    // Non-participants get 404, not 403: the existence of other people's swaps is not disclosed (IDOR).
    if (!swap || !role) throw new NotFoundError('Swap not found');
    return { swap, role };
  }

  async getForUser(userId: string, swapId: string): Promise<SwapDto> {
    const { swap } = await this.load(swapId, userId);
    return this.present(swap, userId);
  }

  async present(swap: Swap, viewerId: string): Promise<SwapDto> {
    const [initiator, receiver, meetup, rated, units, unread] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: swap.initiatorId } }),
      prisma.user.findUniqueOrThrow({ where: { id: swap.receiverId } }),
      prisma.meetup.findFirst({ where: { swapId: swap.id, status: { in: ['PROPOSED', 'COUNTER_PROPOSED', 'ACCEPTED', 'RESCHEDULED', 'COMPLETED'] } }, orderBy: { createdAt: 'desc' } }),
      prisma.rating.count({ where: { swapId: swap.id, giverId: viewerId } }),
      currencyService.unitMap(),
      prisma.message.count({ where: { swapId: swap.id, senderId: { not: viewerId }, readAt: null, isDeleted: false } }),
    ]);
    return toSwapDto(swap, { viewerId, initiator, receiver, meetup: meetup as Meetup | null, hasRated: rated > 0, units, unreadMessages: unread });
  }

  async list(userId: string, q: { status?: SwapStatus | 'ACTIVE'; page: number; perPage: number }) {
    const statusFilter: Prisma.SwapWhereInput =
      q.status === 'ACTIVE' ? { status: { in: ['PENDING', 'AGREED', 'IN_PROGRESS', 'CONFIRMING', 'DISPUTED'] } } : q.status ? { status: q.status } : {};
    const where: Prisma.SwapWhereInput = { OR: [{ initiatorId: userId }, { receiverId: userId }], ...statusFilter };
    const [rows, total] = await Promise.all([
      prisma.swap.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.perPage, take: q.perPage }),
      prisma.swap.count({ where }),
    ]);
    return { items: await Promise.all(rows.map((s) => this.present(s, userId))), total };
  }

  async events(userId: string, swapId: string): Promise<SwapEventDto[]> {
    const { swap } = await this.load(swapId, userId);
    const rows = await prisma.swapEvent.findMany({ where: { swapId, eventType: { notIn: ['SIDE_EFFECTS_APPLIED', 'RESERVATION_HELD', 'RESERVATION_RELEASED', 'RESERVATION_CONSUMED'] } }, orderBy: { createdAt: 'asc' } });
    return rows.map((e) => ({
      id: e.id, eventType: e.eventType,
      actor: !e.actorId ? 'SYSTEM' : e.actorId === swap.initiatorId ? 'INITIATOR' : e.actorId === swap.receiverId ? 'RECEIVER' : 'STAFF',
      previousStatus: e.previousStatus, newStatus: e.newStatus, createdAt: e.createdAt.toISOString(),
    }));
  }

  // ───────────── transitions ─────────────

  /**
   * One guarded write per transition: `where status = expected`. Two requests
   * racing for the same transition cannot both win; the loser gets a 409.
   */
  private async transition(
    swap: Swap,
    to: SwapStatus,
    actor: Actor,
    extra: Prisma.SwapUpdateManyMutationInput = {},
    where: Prisma.SwapWhereInput = {}
  ): Promise<void> {
    try {
      assertTransition(swap.status, to);
    } catch (e) {
      if (e instanceof IllegalSwapTransitionError) throw new InvalidStateError(`Cannot move a swap from ${swap.status} to ${to}`);
      throw e;
    }
    if (!actorMayTransition(swap.status, to, actor.role)) throw new ForbiddenError('You are not allowed to perform this action');
    const r = await prisma.swap.updateMany({ where: { id: swap.id, status: swap.status, ...where }, data: { status: to, ...extra } });
    if (r.count !== 1) throw new InvalidStateError('The swap changed while you were acting. Refresh and try again.');
  }

  async accept(userId: string, swapId: string): Promise<SwapDto> {
    const { swap, role } = await this.load(swapId, userId);
    if (role !== 'RECEIVER') throw new ForbiddenError('Only the offer owner can accept');
    if (swap.status !== 'PENDING') throw new InvalidStateError('This request is no longer pending');
    if (swap.expiresAt <= new Date()) {
      await this.expireOne(swap);
      throw new InvalidStateError('This request has expired');
    }
    const receiver = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.assertMayTrade(receiver);
    await limitService.assertCanStartSwap(userId);
    await limitService.assertSwapAllowed(userId, swap.haveCurrency, swap.requestedHaveMinor);

    const now = new Date();
    const agreedTtl = await systemConfig.getInt('swap.agreedTtlHours');
    const expiresAt = new Date(now.getTime() + hours(agreedTtl));
    // The agreed terms are frozen here and never recomputed from the offer.
    await this.transition(
      swap, 'AGREED', { userId, role: 'RECEIVER' },
      { agreedHaveMinor: swap.requestedHaveMinor, agreedWantMinor: swap.requestedWantMinor, agreedRateScaled: swap.requestedRateScaled, agreedAt: now, expiresAt },
      { expiresAt: { gt: now } }
    );
    await reservationService.extend(swap.id, expiresAt);
    await this.record(swap.id, 'ACCEPTED', { actorId: userId, previous: 'PENDING', next: 'AGREED', dedupeKey: `ACCEPTED:${swap.id}` });
    await notificationService.notify({ userId: swap.initiatorId, type: 'SWAP_ACCEPTED', entityId: swap.id, params: { name: first(receiver.name) }, dedupeKey: `swap:${swap.id}:accepted` });
    return this.getForUser(userId, swapId);
  }

  async reject(userId: string, swapId: string, reason?: string): Promise<SwapDto> {
    const { swap, role } = await this.load(swapId, userId);
    if (role !== 'RECEIVER') throw new ForbiddenError('Only the offer owner can decline');
    await this.cancelInternal(swap, { userId, role: 'RECEIVER' }, 'REJECTED', reason ?? 'Declined', 'REJECTED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await notificationService.notify({ userId: swap.initiatorId, type: 'SWAP_REJECTED', entityId: swap.id, params: { name: first(user.name) }, dedupeKey: `swap:${swap.id}:rejected` });
    return this.getForUser(userId, swapId);
  }

  async cancel(userId: string, swapId: string, reason: string): Promise<SwapDto> {
    const { swap, role } = await this.load(swapId, userId);
    await this.cancelInternal(swap, { userId, role }, 'USER_CANCELLED', reason, 'CANCELLED');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const other = role === 'INITIATOR' ? swap.receiverId : swap.initiatorId;
    await notificationService.notify({ userId: other, type: 'SWAP_CANCELLED', entityId: swap.id, params: { name: first(user.name) }, dedupeKey: `swap:${swap.id}:cancelled` });
    // A cancellation after the other side had agreed counts against reliability.
    if (swap.status === 'AGREED') {
      await prisma.user.update({ where: { id: userId }, data: { cancelledSwaps: { increment: 1 } } });
      void riskService.onSwapCancelled(userId).catch(() => undefined);
    }
    await logActivity(userId, 'SWAP_CANCELLED', 'Swap cancelled', { swapId });
    return this.getForUser(userId, swapId);
  }

  /** PENDING|AGREED|DISPUTED → CANCELLED, releasing the offer slice exactly once. */
  async cancelInternal(swap: Swap, actor: Actor, code: SwapCancelCode, reason: string, eventType: SwapEventType): Promise<void> {
    await this.transition(swap, 'CANCELLED', actor, { cancelledAt: new Date(), cancelledBy: actor.userId ?? undefined, cancelCode: code, cancellationReason: reason.slice(0, 300) });
    await this.record(swap.id, eventType, { actorId: actor.userId, previous: swap.status, next: 'CANCELLED', metadata: { code }, dedupeKey: `CANCELLED:${swap.id}` });
    if (await reservationService.release(swap.id, code === 'EXPIRED' ? 'EXPIRED' : 'RELEASED')) {
      await this.record(swap.id, 'RESERVATION_RELEASED', { dedupeKey: `RESERVATION_RELEASED:${swap.id}` });
    }
    await prisma.meetup.updateMany({ where: { swapId: swap.id, status: { in: ['PROPOSED', 'COUNTER_PROPOSED', 'ACCEPTED', 'RESCHEDULED'] } }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
  }

  /** AGREED → IN_PROGRESS. Called when both parties have checked in at the accepted meetup (or by either party once it is accepted). */
  async start(actor: Actor, swapId: string): Promise<void> {
    const swap = await prisma.swap.findUnique({ where: { id: swapId } });
    if (!swap) throw new NotFoundError('Swap not found');
    if (swap.status === 'IN_PROGRESS') return; // idempotent
    const accepted = await prisma.meetup.count({ where: { swapId, status: { in: ['ACCEPTED', 'RESCHEDULED'] } } });
    if (!accepted) throw new InvalidStateError('A meetup must be agreed first');
    await this.transition(swap, 'IN_PROGRESS', actor, { startedAt: new Date() });
    await this.record(swapId, 'STARTED', { actorId: actor.userId, previous: 'AGREED', next: 'IN_PROGRESS', dedupeKey: `STARTED:${swapId}` });
    for (const uid of [swap.initiatorId, swap.receiverId]) {
      await notificationService.notify({ userId: uid, type: 'SWAP_STARTED', entityId: swap.id, params: { name: '' }, dedupeKey: `swap:${swap.id}:started:${uid}` });
    }
  }

  async startAsParticipant(userId: string, swapId: string): Promise<SwapDto> {
    const { role } = await this.load(swapId, userId);
    await this.start({ userId, role }, swapId);
    return this.getForUser(userId, swapId);
  }

  /**
   * Each party confirms they handed over and received their cash. The swap
   * completes when BOTH have confirmed. Concurrent confirmations are safe:
   *  - each side's flag is set by a guarded update,
   *  - exactly one request wins CONFIRMING → COMPLETED,
   *  - side effects are claimed through unique SwapEvent dedupe keys.
   */
  async confirm(userId: string, swapId: string, extra?: { rating?: number; comment?: string }): Promise<SwapDto> {
    const { swap, role } = await this.load(swapId, userId);
    if (!['IN_PROGRESS', 'CONFIRMING'].includes(swap.status)) {
      if (swap.status === 'COMPLETED') return this.getForUser(userId, swapId); // idempotent replay
      throw new InvalidStateError('This swap cannot be confirmed right now');
    }
    const mine = role === 'INITIATOR' ? 'initiatorConfirmed' : 'receiverConfirmed';
    const mineAt = role === 'INITIATOR' ? 'initiatorConfirmedAt' : 'receiverConfirmedAt';

    const flagged = await prisma.swap.updateMany({
      where: { id: swapId, status: { in: ['IN_PROGRESS', 'CONFIRMING'] }, [mine]: false },
      data: { [mine]: true, [mineAt]: new Date() },
    });
    if (flagged.count === 1) {
      await this.record(swapId, 'PARTY_CONFIRMED', { actorId: userId, dedupeKey: `PARTY_CONFIRMED:${swapId}:${userId}` });
    }

    // First confirmation moves IN_PROGRESS → CONFIRMING (guarded; a lost race is fine).
    const moved = await prisma.swap.updateMany({ where: { id: swapId, status: 'IN_PROGRESS' }, data: { status: 'CONFIRMING' } });
    if (moved.count === 1) await this.record(swapId, 'PARTY_CONFIRMED', { actorId: userId, previous: 'IN_PROGRESS', next: 'CONFIRMING', dedupeKey: `CONFIRMING:${swapId}` });

    const after = await prisma.swap.findUniqueOrThrow({ where: { id: swapId } });
    if (after.initiatorConfirmed && after.receiverConfirmed && after.status === 'CONFIRMING') {
      await this.complete(after, { userId, role });
    } else if (flagged.count === 1) {
      const other = role === 'INITIATOR' ? swap.receiverId : swap.initiatorId;
      const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      await notificationService.notify({ userId: other, type: 'SWAP_CONFIRMED', entityId: swapId, params: { name: first(me.name) }, dedupeKey: `swap:${swapId}:confirmed:${userId}` });
    }

    if (extra?.rating) {
      await ratingService.rate(userId, swapId, { stars: extra.rating, comment: extra.comment }).catch((e) => logger.info('rating skipped', { m: (e as Error).message }));
    }
    return this.getForUser(userId, swapId);
  }

  /** CONFIRMING → COMPLETED. The single winner applies side effects. */
  private async complete(swap: Swap, actor: Actor): Promise<void> {
    const won = await prisma.swap.updateMany({ where: { id: swap.id, status: 'CONFIRMING' }, data: { status: 'COMPLETED', completedAt: new Date() } });
    if (won.count !== 1) return; // the other confirmation got there first
    await this.finishCompletion(swap.id, actor.userId, 'CONFIRMING');
  }

  /** Shared by normal completion and dispute-resolution completion. Idempotent. */
  async finishCompletion(swapId: string, actorId: string | null, previous: SwapStatus): Promise<void> {
    await this.record(swapId, 'COMPLETED', { actorId, previous, next: 'COMPLETED', dedupeKey: `COMPLETED:${swapId}` });
    await this.applySideEffects(swapId);
  }

  /**
   * Each effect is claimed through a unique dedupe key BEFORE it runs, so a
   * duplicate request / retry / recovery job can never apply it twice.
   * (Counters are additionally re-derivable: see recomputeUserStats.)
   */
  async applySideEffects(swapId: string): Promise<void> {
    const swap = await prisma.swap.findUnique({ where: { id: swapId } });
    if (!swap || swap.status !== 'COMPLETED') return;

    if (await this.record(swapId, 'RESERVATION_CONSUMED', { dedupeKey: `RESERVATION_CONSUMED:${swapId}` })) {
      await reservationService.consume(swapId);
    }
    for (const uid of [swap.initiatorId, swap.receiverId]) {
      if (await this.record(swapId, 'SIDE_EFFECTS_APPLIED', { actorId: uid, metadata: { step: 'counters' }, dedupeKey: `EFFECT:counters:${swapId}:${uid}` })) {
        await prisma.user.update({ where: { id: uid }, data: { totalSwaps: { increment: 1 }, successfulSwaps: { increment: 1 } } });
        await ratingService.recomputeTrust(uid).catch(() => undefined);
      }
      if (await this.record(swapId, 'SIDE_EFFECTS_APPLIED', { actorId: uid, metadata: { step: 'notify' }, dedupeKey: `EFFECT:notify:${swapId}:${uid}` })) {
        const other = uid === swap.initiatorId ? swap.receiverId : swap.initiatorId;
        const o = await prisma.user.findUnique({ where: { id: other }, select: { name: true } });
        await notificationService.notify({ userId: uid, type: 'SWAP_COMPLETED', entityId: swapId, params: { name: first(o?.name ?? '') }, dedupeKey: `swap:${swapId}:completed:${uid}` });
        await logActivity(uid, 'SWAP_COMPLETED', 'Swap completed', { swapId });
      }
      if (await this.record(swapId, 'SIDE_EFFECTS_APPLIED', { actorId: uid, metadata: { step: 'referral' }, dedupeKey: `EFFECT:referral:${swapId}:${uid}` })) {
        await referralService.onQualifyingEvent(uid, 'FIRST_COMPLETED_SWAP').catch(() => undefined);
        await referralService.onQualifyingEvent(uid, 'VERIFIED_AND_SWAP').catch(() => undefined);
      }
    }
    if (await this.record(swapId, 'SIDE_EFFECTS_APPLIED', { metadata: { step: 'analytics' }, dedupeKey: `EFFECT:analytics:${swapId}` })) {
      await marketService.recordCompletedSwap(swap).catch(() => undefined);
    }
  }

  // ───────────── dispute integration ─────────────

  async markDisputed(swapId: string, actor: Actor): Promise<void> {
    const swap = await prisma.swap.findUnique({ where: { id: swapId } });
    if (!swap) throw new NotFoundError('Swap not found');
    if (swap.status === 'DISPUTED') return;
    await this.transition(swap, 'DISPUTED', actor);
    await this.record(swapId, 'DISPUTED', { actorId: actor.userId, previous: swap.status, next: 'DISPUTED', dedupeKey: `DISPUTED:${swapId}` });
  }

  /** Staff resolution: DISPUTED → COMPLETED | CANCELLED. Exchanged currency is never refunded by CashMouver. */
  async resolveDisputed(swapId: string, staffId: string, outcome: 'COMPLETED' | 'CANCELLED', note: string): Promise<void> {
    const swap = await prisma.swap.findUnique({ where: { id: swapId } });
    if (!swap) throw new NotFoundError('Swap not found');
    if (swap.status !== 'DISPUTED') return;
    const actor: Actor = { userId: staffId, role: 'STAFF' };
    if (outcome === 'COMPLETED') {
      await this.transition(swap, 'COMPLETED', actor, { completedAt: new Date(), initiatorConfirmed: true, receiverConfirmed: true });
      await this.record(swapId, 'DISPUTE_RESOLVED', { actorId: staffId, previous: 'DISPUTED', next: 'COMPLETED', dedupeKey: `DISPUTE_RESOLVED:${swapId}` });
      await this.finishCompletion(swapId, staffId, 'DISPUTED');
    } else {
      await this.cancelInternal(swap, actor, 'DISPUTE_RESOLUTION', note, 'DISPUTE_RESOLVED');
      for (const uid of [swap.initiatorId, swap.receiverId]) {
        await notificationService.notify({ userId: uid, type: 'SWAP_CANCELLED', entityId: swapId, params: { name: '' }, dedupeKey: `swap:${swapId}:cancelled:${uid}` });
      }
    }
  }

  // ───────────── extension & reminders ─────────────

  async extend(userId: string, swapId: string, extraHours: number): Promise<SwapDto> {
    const { swap } = await this.load(swapId, userId);
    if (!['PENDING', 'AGREED'].includes(swap.status)) throw new InvalidStateError('Only open requests can be extended');
    const max = await systemConfig.getInt('swap.maxExtensionHours');
    if (extraHours > max) throw new ValidationError(`You can extend by at most ${max} hours`);
    const used = await prisma.swapEvent.count({ where: { swapId, eventType: 'EXTENSION_REQUESTED' } });
    if (used >= 2) throw new ConflictError('This swap has already been extended twice');
    const expiresAt = new Date(Math.max(swap.expiresAt.getTime(), Date.now()) + hours(extraHours));
    const r = await prisma.swap.updateMany({ where: { id: swapId, status: swap.status, expiresAt: swap.expiresAt }, data: { expiresAt } });
    if (r.count !== 1) throw new ConflictError('The swap changed while you were acting');
    await reservationService.extend(swapId, expiresAt);
    await this.record(swapId, 'EXTENSION_REQUESTED', { actorId: userId, metadata: { hours: extraHours }, dedupeKey: `EXTENSION_REQUESTED:${swapId}:${used + 1}` });
    return this.getForUser(userId, swapId);
  }

  // ───────────── jobs ─────────────

  private async expireOne(swap: Swap): Promise<boolean> {
    try {
      await this.cancelInternal(swap, { userId: null, role: 'SYSTEM' }, 'EXPIRED', 'Expired', 'EXPIRED');
      for (const uid of [swap.initiatorId, swap.receiverId]) {
        await notificationService.notify({ userId: uid, type: 'SWAP_CANCELLED', entityId: swap.id, params: { name: '' }, dedupeKey: `swap:${swap.id}:expired:${uid}` });
      }
      return true;
    } catch (e) {
      if (e instanceof InvalidStateError) return false; // someone else moved it
      throw e;
    }
  }

  /** Unanswered requests / un-scheduled agreements expire and free the offer slice. */
  async expireElapsed(now = new Date()): Promise<number> {
    const rows = await prisma.swap.findMany({ where: { status: { in: ['PENDING', 'AGREED'] }, expiresAt: { lte: now } }, take: 200 });
    let n = 0;
    for (const s of rows) if (await this.expireOne(s)) n++;
    return n;
  }

  async sendReminders(now = new Date()): Promise<number> {
    const soon = new Date(now.getTime() + hours(2));
    const rows = await prisma.swap.findMany({ where: { status: { in: ['PENDING', 'AGREED'] }, expiresAt: { gt: now, lte: soon }, remindersSent: 0 }, take: 200 });
    for (const s of rows) {
      const claimed = await prisma.swap.updateMany({ where: { id: s.id, remindersSent: 0 }, data: { remindersSent: 1, lastReminderAt: now } });
      if (claimed.count !== 1) continue;
      await this.record(s.id, 'REMINDER_SENT', { dedupeKey: `REMINDER_SENT:${s.id}` });
      const target = s.status === 'PENDING' ? s.receiverId : s.initiatorId;
      await notificationService.notify({ userId: target, type: s.status === 'PENDING' ? 'SWAP_REQUEST' : 'MEETUP_PROPOSED', entityId: s.id, params: { name: '', amount: '' }, dedupeKey: `swap:${s.id}:reminder` });
    }
    return rows.length;
  }

  /** Recovery: finish side effects for swaps whose process died mid-completion. */
  async repairCompletions(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - 2 * 60_000);
    const rows = await prisma.swap.findMany({ where: { status: 'COMPLETED', completedAt: { lte: cutoff, gte: new Date(now.getTime() - 7 * 86_400_000) } }, take: 200 });
    let fixed = 0;
    for (const s of rows) {
      const done = await prisma.swapEvent.count({ where: { swapId: s.id, dedupeKey: { in: [`EFFECT:analytics:${s.id}`, `RESERVATION_CONSUMED:${s.id}`] } } });
      if (done < 2) {
        await this.applySideEffects(s.id);
        fixed++;
      }
    }
    return fixed;
  }

  /** Counters are derived data: rebuild them from swap history (nightly reconcile). */
  async recomputeUserStats(userId: string): Promise<void> {
    const where = { OR: [{ initiatorId: userId }, { receiverId: userId }] };
    const [total, ok, cancelledByMe, disputed] = await Promise.all([
      prisma.swap.count({ where: { AND: [where, { OR: [{ status: 'COMPLETED' }, { startedAt: { not: null } }] }] } }),
      prisma.swap.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.swap.count({ where: { cancelledBy: userId, status: 'CANCELLED', cancelCode: 'USER_CANCELLED' } }),
      prisma.dispute.count({ where: { OR: [{ reporterId: userId }, { againstId: userId }] } }),
    ]);
    await prisma.user.update({ where: { id: userId }, data: { totalSwaps: total, successfulSwaps: ok, cancelledSwaps: cancelledByMe, disputedSwaps: disputed } });
    await ratingService.recomputeTrust(userId);
  }

  canTransitionTo(from: SwapStatus, to: SwapStatus) {
    return canTransition(from, to);
  }
}

export const swapService = new SwapService();
