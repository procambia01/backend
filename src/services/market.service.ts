import type { Swap } from '@prisma/client';
import type { MarketStatDto } from '@/contracts';
import { prisma } from '@/config/database';
import { RATE_SCALE, roundDiv, scaledToRate, fromMinor } from '@/lib/money';
import { currencyService } from './currency.service';
import { limitService } from './limit.service';

/** Aggregated figures are only published when at least this many offers back them (no PII leakage). */
export const MIN_OFFERS_FOR_PUBLIC_STAT = 3;
const day = (d = new Date()) => d.toISOString().slice(0, 10);

export class MarketService {
  /** Completion counts are derived from swaps by the aggregation job; nothing to mutate here. */
  async recordCompletedSwap(_swap: Swap): Promise<void> {
    return;
  }

  /**
   * Job: rebuilds today's per-pair statistics from live offers and completed
   * swaps. Idempotent (upsert on pair+day+country).
   */
  async aggregateToday(now = new Date()): Promise<number> {
    const today = day(now);
    const start = new Date(`${today}T00:00:00.000Z`);
    const offers = await prisma.swapOffer.findMany({
      where: { status: 'ACTIVE', availableUntil: { gt: now }, remainingMinor: { gt: 0n } },
      select: { haveCurrency: true, wantCurrency: true, rateScaled: true, remainingMinor: true, country: true },
      take: 20_000,
    });
    const swaps = await prisma.swap.groupBy({ by: ['haveCurrency', 'wantCurrency'], where: { status: 'COMPLETED', completedAt: { gte: start } }, _count: { _all: true } });
    const swapCount = new Map(swaps.map((s) => [`${s.haveCurrency}/${s.wantCurrency}`, s._count._all]));

    type Bucket = { rates: bigint[]; supply: bigint };
    const buckets = new Map<string, Bucket>();
    const add = (base: string, quote: string, country: string, rate: bigint, supply: bigint) => {
      const key = `${base}|${quote}|${country}`;
      const b = buckets.get(key) ?? { rates: [], supply: 0n };
      b.rates.push(rate);
      b.supply += supply;
      buckets.set(key, b);
    };
    for (const o of offers) {
      add(o.haveCurrency, o.wantCurrency, 'ALL', o.rateScaled, o.remainingMinor);
      add(o.haveCurrency, o.wantCurrency, o.country, o.rateScaled, o.remainingMinor);
    }
    let written = 0;
    for (const [key, b] of buckets) {
      const [base, quote, country] = key.split('|');
      const sorted = [...b.rates].sort((a, c) => (a < c ? -1 : a > c ? 1 : 0));
      const avg = roundDiv(sorted.reduce((s, r) => s + r, 0n), BigInt(sorted.length));
      const reverse = buckets.get(`${quote}|${base}|${country}`);
      const data = {
        avgRateScaled: avg, minRateScaled: sorted[0], maxRateScaled: sorted[sorted.length - 1], bestRateScaled: sorted[0],
        offerCount: sorted.length, swapCount: country === 'ALL' ? (swapCount.get(`${base}/${quote}`) ?? 0) : 0,
        supplyMinor: b.supply, demandMinor: reverse?.supply ?? 0n,
      };
      await prisma.marketRateStat.upsert({
        where: { baseCurrency_quoteCurrency_day_country: { baseCurrency: base, quoteCurrency: quote, day: today, country } },
        create: { baseCurrency: base, quoteCurrency: quote, day: today, country, ...data },
        update: data,
      });
      written++;
    }
    return written;
  }

  /** Public, aggregated, k-anonymous. */
  async pairStats(base: string, quote: string, days: number, userId?: string, country = 'ALL'): Promise<MarketStatDto[]> {
    const wantsAdvanced = days > 7 || country !== 'ALL';
    if (wantsAdvanced) {
      if (!userId) {
        const { PlanRequiredError } = await import('@/utils/error.util');
        throw new PlanRequiredError('Advanced analytics requires a Premium plan');
      }
      await limitService.assertFeature(userId, 'advancedAnalytics');
    }
    const from = day(new Date(Date.now() - days * 86_400_000));
    const rows = await prisma.marketRateStat.findMany({
      where: { baseCurrency: base, quoteCurrency: quote, country, day: { gte: from }, offerCount: { gte: MIN_OFFERS_FOR_PUBLIC_STAT } },
      orderBy: { day: 'asc' },
    });
    const [bu] = await Promise.all([currencyService.minorUnit(base)]);
    return rows.map((r) => ({
      baseCurrency: r.baseCurrency, quoteCurrency: r.quoteCurrency, day: r.day,
      averageRate: scaledToRate(r.avgRateScaled), minRate: scaledToRate(r.minRateScaled), maxRate: scaledToRate(r.maxRateScaled), bestRate: scaledToRate(r.bestRateScaled),
      offerCount: r.offerCount, swapCount: r.swapCount, supply: fromMinor(r.supplyMinor, bu),
    }));
  }

  async popularPairs(days = 7, limit = 10) {
    const from = day(new Date(Date.now() - days * 86_400_000));
    const rows = await prisma.marketRateStat.findMany({ where: { country: 'ALL', day: { gte: from }, offerCount: { gte: MIN_OFFERS_FOR_PUBLIC_STAT } } });
    const agg = new Map<string, { base: string; quote: string; offers: number; swaps: number }>();
    for (const r of rows) {
      const k = `${r.baseCurrency}/${r.quoteCurrency}`;
      const a = agg.get(k) ?? { base: r.baseCurrency, quote: r.quoteCurrency, offers: 0, swaps: 0 };
      a.offers += r.offerCount;
      a.swaps += r.swapCount;
      agg.set(k, a);
    }
    return [...agg.values()].sort((a, b) => b.swaps * 5 + b.offers - (a.swaps * 5 + a.offers)).slice(0, limit);
  }

  /** Country-level activity (premium analytics). Only countries with enough offers are listed. */
  async geographicActivity(userId: string, days = 7) {
    await limitService.assertFeature(userId, 'advancedAnalytics');
    const from = day(new Date(Date.now() - days * 86_400_000));
    const rows = await prisma.marketRateStat.findMany({ where: { country: { not: 'ALL' }, day: { gte: from }, offerCount: { gte: MIN_OFFERS_FOR_PUBLIC_STAT } } });
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.country, (m.get(r.country) ?? 0) + r.offerCount);
    return [...m.entries()].map(([country, offers]) => ({ country, offers })).sort((a, b) => b.offers - a.offers);
  }

  async purgeOld(days = 800) {
    const r = await prisma.marketRateStat.deleteMany({ where: { day: { lt: day(new Date(Date.now() - days * 86_400_000)) } } });
    return r.count;
  }
  ratePlaceholder() {
    return RATE_SCALE;
  }
}

export const marketService = new MarketService();
