import { Request, Response } from 'express';
import { prisma } from '@/config/database';
import { ExchangeRateService } from '@/services/exchangeRate.service';
import ResponseUtil from '@/utils/response.util';
import { BadRequestError } from '@/utils/error.util';

const exchangeRateService = new ExchangeRateService();

export class PartnerController {
  /**
   * GET /partner/rates?from=USD&to=NGN
   * The official/reference rate. For real peer-agreed street rates, see
   * getMarketRates below — that's the actually differentiated data.
   */
  getRate = async (req: Request, res: Response): Promise<Response> => {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) throw new BadRequestError('from and to currency codes are required');
    const rate = await exchangeRateService.getRate(from.toUpperCase(), to.toUpperCase());
    return ResponseUtil.success(res, { from: from.toUpperCase(), to: to.toUpperCase(), rate });
  };

  /**
   * GET /partner/market-rates?from=USD&to=NGN&days=7
   * The actual peer-agreed exchange rates from completed swaps in this
   * corridor — this is the data an official/bank rate can't give a
   * partner, and is the core value of the partner tier.
   */
  getMarketRates = async (req: Request, res: Response): Promise<Response> => {
    const { from, to, days } = req.query as { from?: string; to?: string; days?: string };
    if (!from || !to) throw new BadRequestError('from and to currency codes are required');

    const since = new Date();
    since.setDate(since.getDate() - (Number(days) || 7));

    const swaps = await prisma.swap.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: since },
        OR: [
          { initiatorGivesCurrency: from.toUpperCase(), receiverGivesCurrency: to.toUpperCase() },
          { initiatorGivesCurrency: to.toUpperCase(), receiverGivesCurrency: from.toUpperCase() },
        ],
      },
      select: { agreedExchangeRate: true, completedAt: true },
      orderBy: { completedAt: 'desc' },
      take: 500,
    });

    if (swaps.length === 0) {
      return ResponseUtil.success(res, {
        from: from.toUpperCase(),
        to: to.toUpperCase(),
        sampleSize: 0,
        message: 'No completed swaps in this corridor for the selected window',
      });
    }

    const rates: number[] = swaps.map((s: { agreedExchangeRate: number }) => s.agreedExchangeRate);
    const avg = rates.reduce((a: number, b: number) => a + b, 0) / rates.length;
    const sorted = [...rates].sort((a: number, b: number) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    return ResponseUtil.success(res, {
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      sampleSize: rates.length,
      averageRate: Math.round(avg * 10000) / 10000,
      medianRate: Math.round(median * 10000) / 10000,
      minRate: Math.round(sorted[0] * 10000) / 10000,
      maxRate: Math.round(sorted[sorted.length - 1] * 10000) / 10000,
      windowDays: Number(days) || 7,
    });
  };

  /**
   * GET /partner/offer-density?country=NG&city=Lagos
   * Anonymized supply/demand signal by corridor — no user PII, just
   * counts. Useful for a bureau deciding where to source liquidity.
   */
  getOfferDensity = async (req: Request, res: Response): Promise<Response> => {
    const { country, city } = req.query as { country?: string; city?: string };
    if (!country) throw new BadRequestError('country is required');

    const where: any = { status: 'ACTIVE', country: country.toUpperCase() };
    if (city) where.city = city;

    const offers = await prisma.swapOffer.groupBy({
      by: ['haveCurrency', 'wantCurrency'],
      where,
      _count: true,
    });

    return ResponseUtil.success(
      res,
      offers.map((o: { haveCurrency: string; wantCurrency: string; _count: number }) => ({
        haveCurrency: o.haveCurrency,
        wantCurrency: o.wantCurrency,
        activeOffers: o._count,
      }))
    );
  };

  /** GET /partner/usage — this key's own request stats */
  getUsage = async (req: Request, res: Response): Promise<Response> => {
    const key = await prisma.apiKey.findUnique({ where: { id: req.apiClient!.keyId } });
    return ResponseUtil.success(res, {
      requestCount: key?.requestCount ?? 0,
      rateLimitPerMinute: key?.rateLimitPerMinute ?? 0,
      lastUsedAt: key?.lastUsedAt ?? null,
    });
  };
}
