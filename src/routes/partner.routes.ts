import { Router, z, h, ok } from './_h';
import { apiKeyAuth } from '@/middleware/apiKeyAuth.middleware';
import { RateLimitMiddleware as RL } from '@/middleware/rateLimit.middleware';
import { validateParams, validateQuery } from '@/middleware/validate.middleware';
import { offerSearchQuery, currencyCode } from '@/contracts';
import { exchangeRateService } from '@/services/exchangeRate.service';
import { marketService } from '@/services/market.service';
import { offerService } from '@/services/offer.service';
import { currencyService } from '@/services/currency.service';
import ResponseUtil from '@/utils/response.util';

/** Partner API: X-API-Key. Public marketplace data only — no personal, location or KYC data. */
const router = Router();
const pair = z.object({ base: currencyCode, quote: currencyCode });

router.get('/rates/:base/:quote', apiKeyAuth('rates:read'), RL.apiKey, validateParams(pair), h(async (req, res) => ok(res, await exchangeRateService.getRate(String(req.params.base), String(req.params.quote)))));
router.get('/currencies', apiKeyAuth('rates:read'), RL.apiKey, h(async (_req, res) => ok(res, await currencyService.listActive())));
router.get('/market/:base/:quote', apiKeyAuth('market:read'), RL.apiKey, validateParams(pair), h(async (req, res) => ok(res, await marketService.pairStats(String(req.params.base), String(req.params.quote), 7, undefined, 'ALL'))));
router.get('/offers', apiKeyAuth('offers:read'), RL.apiKey, validateQuery(offerSearchQuery), h(async (req, res) => {
  const q = req.query as never as z.infer<typeof offerSearchQuery>;
  const r = await offerService.search({ ...q, latitude: undefined, longitude: undefined, radiusKm: undefined });
  const items = r.items.map((o) => ({
    id: o.id,
    haveCurrency: o.haveCurrency,
    wantCurrency: o.wantCurrency,
    availableAmount: o.availableAmount,
    exchangeRate: o.exchangeRate,
    country: o.area.country,
    city: o.area.city,
    availableUntil: o.availableUntil,
    sponsored: o.sponsored ?? false,
  }));
  ResponseUtil.paginated(res, items, q.page, q.perPage, r.total);
}));
export default router;
