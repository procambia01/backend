import { Router, z, h, ok, created, paged, idParams, pageQ, param } from './_h';
import { AuthMiddleware as Auth } from '@/middleware/auth.middleware';
import { RateLimitMiddleware as RL } from '@/middleware/rateLimit.middleware';
import { validateBody, validateParams, validateQuery } from '@/middleware/validate.middleware';
import { checkoutSubscriptionSchema, checkoutPromotionSchema, checkoutAdSchema, objectId } from '@/contracts';
import { uid } from '@/lib/http';
import { billingService } from '@/services/billing.service';
import { promotionService } from '@/services/promotion.service';

const router = Router();
router.use(Auth.authenticate);

const verificationCheckout = z.object({ productCode: z.string().min(2).max(64), caseId: objectId });
const cancelSchema = z.object({ cancelAtPeriodEnd: z.boolean() });

const start = async (req: Parameters<Parameters<typeof h>[0]>[0], productCode: string, targetId?: string) =>
  billingService.createCheckout({ userId: uid(req), email: req.user!.email, productCode, targetId });

router.post('/checkout/subscription', RL.checkout, Auth.requireEmailVerified, validateBody(checkoutSubscriptionSchema), h(async (req, res) => created(res, await start(req, req.body.productCode))));
router.post('/checkout/boost', RL.checkout, Auth.requireEmailVerified, validateBody(checkoutPromotionSchema), h(async (req, res) => created(res, await start(req, req.body.productCode, req.body.offerId))));
router.post('/checkout/featured', RL.checkout, Auth.requireEmailVerified, validateBody(checkoutPromotionSchema), h(async (req, res) => created(res, await start(req, req.body.productCode, req.body.offerId))));
router.post('/checkout/verification', RL.checkout, Auth.requireEmailVerified, validateBody(verificationCheckout), h(async (req, res) => created(res, await start(req, req.body.productCode, req.body.caseId))));
router.post('/checkout/advertising', RL.checkout, Auth.requireEmailVerified, validateBody(checkoutAdSchema), h(async (req, res) => created(res, await start(req, req.body.productCode, req.body.campaignId))));

router.get('/payments', validateQuery(pageQ), h(async (req, res) => {
  const q = req.query as never as z.infer<typeof pageQ>;
  paged(res, await billingService.listPayments(uid(req), q.page, q.perPage), q.page, q.perPage);
}));
router.get('/payments/:id', validateParams(idParams), h(async (req, res) => ok(res, await billingService.getPayment(uid(req), param(req)))));
router.get('/subscriptions', h(async (req, res) => ok(res, await billingService.mySubscriptions(uid(req)))));
router.post('/subscriptions/:id/cancel-at-period-end', validateParams(idParams), validateBody(cancelSchema), h(async (req, res) => ok(res, await billingService.setCancelAtPeriodEnd(uid(req), param(req), req.body.cancelAtPeriodEnd))));
router.post('/portal', Auth.requireRecentAuth, h(async (req, res) => ok(res, { url: await billingService.portalUrl(uid(req)) })));
router.get('/promotions', h(async (req, res) => ok(res, await promotionService.historyForUser(uid(req)))));

export default router;
