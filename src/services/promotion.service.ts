import type { BoostDto, FeaturedDto } from '@/contracts';
import { currencyService } from './currency.service';
import { toBoostDto, toFeaturedDto } from '@/presenters/billing.presenter';
import type { Payment } from '@prisma/client';
import { prisma } from '@/config/database';
import { NotFoundError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { notificationService } from './notification.service';

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Paid placement. Boost raises ordinary search ranking; Featured buys a
 * dedicated discovery placement. The dated Boost/FeaturedListing rows are the
 * authority; SwapOffer.boostedUntil / featuredUntil are a denormalised cache.
 */
export class PromotionService {
  private async latestEnd(table: 'boost' | 'featured', offerId: string, now: Date): Promise<Date> {
    const rows =
      table === 'boost'
        ? await prisma.boost.findMany({ where: { offerId, status: 'ACTIVE', endsAt: { gt: now } }, orderBy: { endsAt: 'desc' }, take: 1 })
        : await prisma.featuredListing.findMany({ where: { offerId, status: 'ACTIVE', endsAt: { gt: now } }, orderBy: { endsAt: 'desc' }, take: 1 });
    return rows[0]?.endsAt ?? now;
  }

  /** Idempotent: Boost.paymentId is unique, so re-processing the same payment is a no-op. */
  async grantBoost(payment: Payment): Promise<void> {
    if (!payment.targetId) throw new NotFoundError('Boost has no target offer');
    const existing = await prisma.boost.findUnique({ where: { paymentId: payment.id } });
    if (existing) return;
    const product = await prisma.serviceProduct.findUnique({ where: { code: payment.productCode } });
    const hours = product?.durationHours ?? 24;
    const now = new Date();
    // Stacking purchases queue up after the current boost instead of overlapping.
    const startsAt = await this.latestEnd('boost', payment.targetId, now);
    const endsAt = new Date(startsAt.getTime() + hours * 3600_000);
    try {
      await prisma.boost.create({
        data: { offerId: payment.targetId, userId: payment.userId, paymentId: payment.id, productCode: payment.productCode, startsAt, endsAt, priceMinor: payment.amountMinor, currency: payment.currency },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return;
      throw e;
    }
    await prisma.swapOffer.update({ where: { id: payment.targetId }, data: { boostedUntil: endsAt } });
    await notificationService.notify({ userId: payment.userId, type: 'OFFER_BOOSTED', entityId: payment.targetId, params: { pair: await this.pair(payment.targetId) }, dedupeKey: `boost:${payment.id}` });
  }

  async grantFeatured(payment: Payment): Promise<void> {
    if (!payment.targetId) throw new NotFoundError('Featured listing has no target offer');
    const existing = await prisma.featuredListing.findUnique({ where: { paymentId: payment.id } });
    if (existing) return;
    const product = await prisma.serviceProduct.findUnique({ where: { code: payment.productCode } });
    const hours = product?.durationHours ?? 24;
    const startsAt = await this.latestEnd('featured', payment.targetId, new Date());
    const endsAt = new Date(startsAt.getTime() + hours * 3600_000);
    try {
      await prisma.featuredListing.create({
        data: {
          offerId: payment.targetId, userId: payment.userId, paymentId: payment.id, productCode: payment.productCode,
          placement: product?.placement ?? 'MARKETPLACE_TOP', startsAt, endsAt, priceMinor: payment.amountMinor, currency: payment.currency,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return;
      throw e;
    }
    await prisma.swapOffer.update({ where: { id: payment.targetId }, data: { featuredUntil: endsAt } });
    await notificationService.notify({ userId: payment.userId, type: 'OFFER_FEATURED', entityId: payment.targetId, params: { pair: await this.pair(payment.targetId) }, dedupeKey: `featured:${payment.id}` });
  }

  /** A refunded promotion is cancelled and the offer's cached placement recomputed. */
  async cancelForPayment(paymentId: string): Promise<void> {
    const [b, f] = await Promise.all([prisma.boost.findUnique({ where: { paymentId } }), prisma.featuredListing.findUnique({ where: { paymentId } })]);
    if (b) {
      await prisma.boost.update({ where: { id: b.id }, data: { status: 'CANCELLED' } });
      await this.recomputeOffer(b.offerId);
    }
    if (f) {
      await prisma.featuredListing.update({ where: { id: f.id }, data: { status: 'CANCELLED' } });
      await this.recomputeOffer(f.offerId);
    }
  }

  async recomputeOffer(offerId: string): Promise<void> {
    const now = new Date();
    const [boost, feat] = await Promise.all([this.latestEnd('boost', offerId, now), this.latestEnd('featured', offerId, now)]);
    await prisma.swapOffer.update({ where: { id: offerId }, data: { boostedUntil: boost > now ? boost : null, featuredUntil: feat > now ? feat : null } });
  }

  /** Job: mark elapsed promotions EXPIRED and clear cached placement. */
  async expireElapsed(now = new Date()): Promise<number> {
    const [b, f] = await Promise.all([
      prisma.boost.findMany({ where: { status: 'ACTIVE', endsAt: { lte: now } }, select: { id: true, offerId: true }, take: 500 }),
      prisma.featuredListing.findMany({ where: { status: 'ACTIVE', endsAt: { lte: now } }, select: { id: true, offerId: true }, take: 500 }),
    ]);
    if (b.length) await prisma.boost.updateMany({ where: { id: { in: b.map((x) => x.id) }, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
    if (f.length) await prisma.featuredListing.updateMany({ where: { id: { in: f.map((x) => x.id) }, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
    const offers = new Set([...b, ...f].map((x) => x.offerId));
    for (const id of offers) await this.recomputeOffer(id).catch((e) => logger.warn('recompute placement failed', { id, m: (e as Error).message }));
    return b.length + f.length;
  }

  // ───────────── analytics counters ─────────────

  async recordImpressions(type: 'BOOST' | 'FEATURED', ids: string[]): Promise<void> {
    if (!ids.length) return;
    const day = dayKey();
    await Promise.all(
      ids.map((promotionId) =>
        prisma.promotionDailyStat
          .upsert({ where: { promotionType_promotionId_day: { promotionType: type, promotionId, day } }, create: { promotionType: type, promotionId, day, impressions: 1 }, update: { impressions: { increment: 1 } } })
          .catch(() => undefined)
      )
    );
    const model = type === 'BOOST' ? prisma.boost : prisma.featuredListing;
    await (model as typeof prisma.boost).updateMany({ where: { id: { in: ids } }, data: { impressions: { increment: 1 } } }).catch(() => undefined);
  }

  async recordClick(type: 'BOOST' | 'FEATURED', id: string): Promise<void> {
    const day = dayKey();
    await prisma.promotionDailyStat
      .upsert({ where: { promotionType_promotionId_day: { promotionType: type, promotionId: id, day } }, create: { promotionType: type, promotionId: id, day, clicks: 1 }, update: { clicks: { increment: 1 } } })
      .catch(() => undefined);
    const model = type === 'BOOST' ? prisma.boost : prisma.featuredListing;
    await (model as typeof prisma.boost).updateMany({ where: { id }, data: { clicks: { increment: 1 } } }).catch(() => undefined);
  }

  async historyForUser(userId: string): Promise<{ boosts: BoostDto[]; featured: FeaturedDto[] }> {
    const [boosts, featured, units] = await Promise.all([
      prisma.boost.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.featuredListing.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      currencyService.unitMap(),
    ]);
    return { boosts: boosts.map((b) => toBoostDto(b, units)), featured: featured.map((f) => toFeaturedDto(f, units)) };
  }

  async activeFeatured(placement: 'HOMEPAGE' | 'MARKETPLACE_TOP' | 'CURRENCY_PAIR', limit = 6) {
    return prisma.featuredListing.findMany({ where: { placement, status: 'ACTIVE', startsAt: { lte: new Date() }, endsAt: { gt: new Date() } }, orderBy: { startsAt: 'desc' }, take: limit });
  }

  private async pair(offerId: string): Promise<string> {
    const o = await prisma.swapOffer.findUnique({ where: { id: offerId }, select: { haveCurrency: true, wantCurrency: true } });
    return o ? `${o.haveCurrency}/${o.wantCurrency}` : '';
  }
}

export const promotionService = new PromotionService();
