import { prisma } from '@/config/database';
import { config } from '@/config/env';
import { RATE_SCALE, rateToScaled, roundDiv, scaledToRate } from '@/lib/money';
import { BadRequestError, ServiceUnavailableError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { currencyService } from './currency.service';

const PIVOT = 'EUR';
const DEFAULT_URL = 'https://open.er-api.com/v6/latest/EUR';
/** Reference rates older than this are considered stale for validation purposes. */
export const MAX_RATE_AGE_MS = 6 * 3600_000;

export class ExchangeRateService {
  /** Units of `quote` per 1 `base`, fixed-point 1e10, via the EUR pivot. */
  async getRateScaled(base: string, quote: string): Promise<{ rateScaled: bigint; asOf: Date }> {
    base = base.toUpperCase();
    quote = quote.toUpperCase();
    if (base === quote) return { rateScaled: RATE_SCALE, asOf: new Date() };

    const [b, q] = await Promise.all([this.pivotRate(base), this.pivotRate(quote)]);
    // base→quote = (EUR→quote) / (EUR→base)
    const rateScaled = roundDiv(q.rateScaled * RATE_SCALE, b.rateScaled);
    return { rateScaled, asOf: b.asOf < q.asOf ? b.asOf : q.asOf };
  }

  async getRate(base: string, quote: string): Promise<{ rate: string; asOf: string }> {
    const r = await this.getRateScaled(base, quote);
    return { rate: scaledToRate(r.rateScaled), asOf: r.asOf.toISOString() };
  }

  private async pivotRate(code: string): Promise<{ rateScaled: bigint; asOf: Date }> {
    if (code === PIVOT) return { rateScaled: RATE_SCALE, asOf: new Date() };
    const snap = await prisma.exchangeRateSnapshot.findFirst({
      where: { baseCurrency: PIVOT, quoteCurrency: code },
      orderBy: { createdAt: 'desc' },
    });
    if (!snap) throw new ServiceUnavailableError(`No reference rate available for ${code}`);
    return { rateScaled: snap.rateScaled, asOf: snap.createdAt };
  }

  async history(base: string, quote: string, days = 30) {
    const from = new Date(Date.now() - days * 86_400_000);
    const rows = await prisma.exchangeRateSnapshot.findMany({
      where: { baseCurrency: PIVOT, quoteCurrency: { in: [base, quote].filter((c) => c !== PIVOT) }, createdAt: { gte: from } },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
    // Reduce to one point per day for the requested pair.
    const byDay = new Map<string, { b?: bigint; q?: bigint }>();
    for (const r of rows) {
      const day = r.createdAt.toISOString().slice(0, 10);
      const e = byDay.get(day) ?? {};
      if (r.quoteCurrency === base) e.b = r.rateScaled;
      if (r.quoteCurrency === quote) e.q = r.rateScaled;
      byDay.set(day, e);
    }
    const out: { day: string; rate: string }[] = [];
    for (const [day, e] of byDay) {
      const b = base === PIVOT ? RATE_SCALE : e.b;
      const q = quote === PIVOT ? RATE_SCALE : e.q;
      if (b && q) out.push({ day, rate: scaledToRate(roundDiv(q * RATE_SCALE, b)) });
    }
    return out;
  }

  /** Job: fetch the latest reference rates for every ACTIVE currency and snapshot them. */
  async refreshRates(): Promise<number> {
    const url = config.exchangeRate.apiUrl ?? DEFAULT_URL;
    const headers: Record<string, string> = {};
    if (config.exchangeRate.apiKey) headers.Authorization = `Bearer ${config.exchangeRate.apiKey}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`rate provider responded ${res.status}`);
    const body = (await res.json()) as { rates?: Record<string, number | string>; base?: string; base_code?: string };
    const rates = body.rates;
    const base = (body.base ?? body.base_code ?? PIVOT).toUpperCase();
    if (!rates || base !== PIVOT) throw new Error('unexpected rate provider response');

    const active = await currencyService.listActive();
    const data: { baseCurrency: string; quoteCurrency: string; rateScaled: bigint; source: string }[] = [];
    for (const c of active) {
      if (c.code === PIVOT) continue;
      const raw = rates[c.code];
      if (raw === undefined) {
        logger.warn('no reference rate from provider', { currency: c.code });
        continue;
      }
      try {
        const scaled = rateToScaled(String(raw));
        if (scaled > 0n) data.push({ baseCurrency: PIVOT, quoteCurrency: c.code, rateScaled: scaled, source: 'PROVIDER' });
      } catch {
        logger.warn('unparseable reference rate', { currency: c.code });
      }
    }
    if (data.length) await prisma.exchangeRateSnapshot.createMany({ data });
    return data.length;
  }

  async purgeOld(days = 400) {
    const r = await prisma.exchangeRateSnapshot.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) } } });
    return r.count;
  }

  assertPair(a: string, b: string) {
    if (a.toUpperCase() === b.toUpperCase()) throw new BadRequestError('Currencies must differ');
  }
}

export const exchangeRateService = new ExchangeRateService();
