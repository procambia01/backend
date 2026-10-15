import type { SwapOffer, User } from '@prisma/client';
import { prisma } from '@/config/database';
import { fromGeoPoint, haversineKm } from '@/lib/geo';
import { RATE_SCALE, roundDiv } from '@/lib/money';
import logger from '@/utils/logger.util';
import { notificationService } from './notification.service';

export interface ScoreInput {
  /** Fraction of the requested amount this offer can cover (0..1). */
  amountFit: number;
  /** (reference − offerRate)/reference — positive when the rate is better for the searcher. */
  rateAdvantage: number | null;
  distanceKm: number | null;
  radiusKm: number;
  availableNow: boolean;
  ownerVerified: boolean;
  trustScore: number; // 0..100
  completionRate: number; // 0..100
  responseRate: number; // 0..100
  disputeRate: number; // 0..1
  meetupPreferenceMatch: boolean;
  ageHours: number;
  boosted: boolean;
  featured: boolean;
}

export interface ScoreBreakdown {
  organic: number;
  paid: number;
  total: number;
}

/** Maximum points paid placement can ever add (organic score is out of ~100). */
export const PAID_BONUS_CAP = 10;
/** Below this organic score paid placement is scaled down so it cannot rescue an irrelevant result. */
export const PAID_RELEVANCE_FLOOR = 60;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Relevance first, paid placement second. Organic score is built from fit,
 * rate, distance, trust, reliability and freshness. Boost/Featured add a
 * bounded bonus that shrinks for poorly matching offers, so paying can break
 * ties and lift good results but never bury better matches under bad ones.
 */
export function scoreOffer(f: ScoreInput): ScoreBreakdown {
  let organic = 0;
  organic += 15 * clamp01(f.amountFit);
  organic += f.rateAdvantage === null ? 8 : 20 * clamp01(0.5 + f.rateAdvantage * 10); // ±5% maps across the range
  organic += f.distanceKm === null ? 7 : 15 * clamp01(1 - f.distanceKm / Math.max(f.radiusKm, 5) / 3);
  organic += 15 * clamp01(f.trustScore / 100);
  organic += 8 * clamp01(f.completionRate / 100);
  organic += 5 * clamp01(f.responseRate / 100);
  organic -= 10 * clamp01(f.disputeRate * 5);
  organic += f.ownerVerified ? 7 : 0;
  organic += 5 * clamp01(1 - f.ageHours / (24 * 14));
  organic += f.availableNow ? 5 : 0;
  organic += f.meetupPreferenceMatch ? 5 : 0;
  organic = Math.max(0, organic);

  const rawPaid = (f.boosted ? 8 : 0) + (f.featured ? 5 : 0);
  const relevanceFactor = clamp01(organic / PAID_RELEVANCE_FLOOR);
  const paid = Math.min(PAID_BONUS_CAP, rawPaid) * relevanceFactor;
  return { organic, paid, total: organic + paid };
}

export const disputeRateOf = (u: Pick<User, 'totalSwaps' | 'disputedSwaps'>) => (u.totalSwaps > 0 ? u.disputedSwaps / u.totalSwaps : 0);

/** Offers are "inverse-compatible" when rates mutually agree within `toleranceBps`. */
export function ratesCompatible(rateAScaled: bigint, rateBScaled: bigint, toleranceBps = 300): boolean {
  // product of (W per H) and (H per W) should be ≈ 1
  const product = roundDiv(rateAScaled * rateBScaled, RATE_SCALE);
  const diff = product > RATE_SCALE ? product - RATE_SCALE : RATE_SCALE - product;
  return diff * 10_000n <= RATE_SCALE * BigInt(toleranceBps);
}

export class MatchingService {
  /**
   * After an offer is published, tell owners of complementary nearby offers
   * (and the new owner) that a counterpart exists. De-duplicated per pair.
   */
  async notifyMatchesForOffer(offer: SwapOffer): Promise<number> {
    try {
      const candidates = await prisma.swapOffer.findMany({
        where: {
          id: { not: offer.id },
          userId: { not: offer.userId },
          status: 'ACTIVE',
          haveCurrency: offer.wantCurrency,
          wantCurrency: offer.haveCurrency,
          country: offer.country,
          city: offer.city,
          availableUntil: { gt: new Date() },
          availableFrom: { lt: offer.availableUntil },
          remainingMinor: { gt: 0n },
        },
        take: 50,
      });
      const mine = fromGeoPoint(offer.area);
      const compat = candidates
        .filter((c) => ratesCompatible(offer.rateScaled, c.rateScaled))
        .map((c) => {
          const o = fromGeoPoint(c.area);
          return { c, km: mine && o ? haversineKm(mine, o) : 0 };
        })
        .sort((a, b) => a.km - b.km)
        .slice(0, 5);

      for (const { c } of compat) {
        const key = [offer.id, c.id].sort().join(':');
        const pair = `${offer.haveCurrency}/${offer.wantCurrency}`;
        await notificationService.notify({ userId: c.userId, type: 'MATCH_FOUND', entityId: offer.id, params: { pair }, dedupeKey: `match:${key}:${c.userId}` });
        await notificationService.notify({ userId: offer.userId, type: 'MATCH_FOUND', entityId: c.id, params: { pair }, dedupeKey: `match:${key}:${offer.userId}` });
      }
      if (compat.length) await prisma.swapOffer.update({ where: { id: offer.id }, data: { matchCount: { increment: compat.length } } });
      return compat.length;
    } catch (error) {
      logger.warn('match notification failed', { offerId: offer.id, message: (error as Error).message });
      return 0;
    }
  }
}

export const matchingService = new MatchingService();
