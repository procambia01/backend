import { Router, z, h, ok, created, paged, idParams, pageQ, pageOf, param } from './_h';
import { AuthMiddleware as Auth } from '@/middleware/auth.middleware';
import { RateLimitMiddleware as RL } from '@/middleware/rateLimit.middleware';
import { validateBody, validateParams, validateQuery } from '@/middleware/validate.middleware';
import { createOfferSchema, updateOfferSchema, offerSearchQuery, currencyCode } from '@/contracts';
import { uid } from '@/lib/http';
import { offerService } from '@/services/offer.service';

const router = Router();
const mineQuery = pageQ.extend({ status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'EXPIRED']).optional() });
const featuredQuery = z.object({
  placement: z.enum(['HOMEPAGE', 'MARKETPLACE_TOP', 'CURRENCY_PAIR']).default('HOMEPAGE'),
  have: currencyCode.optional(),
  want: currencyCode.optional(),
});

router.get('/', RL.publicSearch, Auth.optionalAuth, validateQuery(offerSearchQuery), h(async (req, res) => {
  const q = req.query as never as z.infer<typeof offerSearchQuery>;
  paged(res, await offerService.search(q, req.user), q.page, q.perPage);
}));
router.get('/featured', RL.publicSearch, Auth.optionalAuth, validateQuery(featuredQuery), h(async (req, res) => {
  const q = req.query as never as z.infer<typeof featuredQuery>;
  ok(res, await offerService.featured(q.placement, req.user, { have: q.have, want: q.want }));
}));
router.get('/mine', Auth.authenticate, validateQuery(mineQuery), h(async (req, res) => {
  const q = req.query as never as z.infer<typeof mineQuery>;
  paged(res, await offerService.mine(uid(req), q.status, q.page, q.perPage), q.page, q.perPage);
}));
router.get('/:id', Auth.optionalAuth, validateParams(idParams), h(async (req, res) => ok(res, await offerService.getById(param(req), req.user))));

router.post('/', Auth.authenticate, Auth.requireEmailVerified, RL.createOffer, validateBody(createOfferSchema), h(async (req, res) => created(res, await offerService.create(uid(req), req.body))));
router.patch('/:id', Auth.authenticate, validateParams(idParams), validateBody(updateOfferSchema), h(async (req, res) => ok(res, await offerService.update(uid(req), param(req), req.body))));
router.post('/:id/pause', Auth.authenticate, validateParams(idParams), h(async (req, res) => ok(res, await offerService.setPaused(uid(req), param(req), true))));
router.post('/:id/resume', Auth.authenticate, validateParams(idParams), h(async (req, res) => ok(res, await offerService.setPaused(uid(req), param(req), false))));
router.delete('/:id', Auth.authenticate, validateParams(idParams), h(async (req, res) => ok(res, await offerService.cancel(uid(req), param(req)))));

export default router;
