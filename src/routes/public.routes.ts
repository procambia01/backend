import { Router, z, h, ok } from './_h';
import { AuthMiddleware as Auth } from '@/middleware/auth.middleware';
import { RateLimitMiddleware as RL } from '@/middleware/rateLimit.middleware';
import { validateParams, validateQuery } from '@/middleware/validate.middleware';
import { currencyCode } from '@/contracts';
import { currencyService } from '@/services/currency.service';
import { exchangeRateService } from '@/services/exchangeRate.service';
import { marketService } from '@/services/market.service';
import { systemConfigService } from '@/services/system-config.service';
import { adService } from '@/services/ad.service';
import { promotionService } from '@/services/promotion.service';
import { referralService } from '@/services/referral.service';
import { billingService } from '@/services/billing.service';

const router = Router();
router.use(RL.publicSearch);

const pairParams = z.object({ base: currencyCode, quote: currencyCode });
const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(7), country: z.string().length(2).toUpperCase().optional() });
const adQuery = z.object({
  placement: z.enum(['HOMEPAGE', 'MARKETPLACE']).default('HOMEPAGE'),
  currency: currencyCode.optional(),
  country: z.string().length(2).toUpperCase().optional(),
  city: z.string().max(100).optional(),
});
const idP = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) });

router.get('/currencies', h(async (_req, res) => ok(res, await currencyService.listActive())));
router.get('/config', h(async (_req, res) => ok(res, await systemConfigService.list(true))));
router.get('/products', h(async (req, res) => ok(res, await billingService.listProducts(typeof req.query.kind === 'string' ? (req.query.kind as never) : undefined))));
router.get('/rates/:base/:quote', validateParams(pairParams), h(async (req, res) => ok(res, await exchangeRateService.getRate(String(req.params.base), String(req.params.quote)))));
router.get('/rates/:base/:quote/history', validateParams(pairParams), validateQuery(z.object({ days: z.coerce.number().int().min(1).max(90).default(30) })), h(async (req, res) => ok(res, await exchangeRateService.history(String(req.params.base), String(req.params.quote), (req.query as never as { days: number }).days))));
router.get('/market/popular', h(async (_req, res) => ok(res, await marketService.popularPairs(7, 10))));
router.get('/market/:base/:quote', Auth.optionalAuth, validateParams(pairParams), validateQuery(daysQuery), h(async (req, res) => {
  const q = req.query as never as z.infer<typeof daysQuery>;
  ok(res, await marketService.pairStats(String(req.params.base), String(req.params.quote), q.days, req.user?.userId, q.country ?? 'ALL'));
}));
router.get('/ads', validateQuery(adQuery), h(async (req, res) => {
  const q = req.query as never as z.infer<typeof adQuery>;
  const ads = await adService.serve(q.placement, { currency: q.currency, country: q.country, city: q.city });
  ok(res, ads);
}));
router.post('/ads/:id/click', validateParams(idP), h(async (req, res) => { await adService.click(String(req.params.id)); ok(res, { recorded: true }); }));
router.post('/promotions/:type/:id/click', validateParams(z.object({ type: z.enum(['boost', 'featured']), id: z.string().regex(/^[a-f0-9]{24}$/i) })), h(async (req, res) => {
  await promotionService.recordClick(String(req.params.type).toUpperCase() as 'BOOST' | 'FEATURED', String(req.params.id));
  ok(res, { recorded: true });
}));
router.post('/referrals/click/:code', validateParams(z.object({ code: z.string().min(3).max(32) })), h(async (req, res) => { await referralService.trackClick(String(req.params.code)); ok(res, { recorded: true }); }));

export default router;
