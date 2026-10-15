import { Router, z, h, ok, created, idParams, param, pageQ, paged } from './_h';
import { AuthMiddleware as Auth } from '@/middleware/auth.middleware';
import { RateLimitMiddleware as RL } from '@/middleware/rateLimit.middleware';
import { validateBody, validateParams, validateQuery } from '@/middleware/validate.middleware';
import { uploadMany } from '@/middleware/upload.middleware';
import { rateAlertSchema, verificationSubmitSchema, apiKeyCreateSchema, adCampaignSchema } from '@/contracts';
import { uid } from '@/lib/http';
import { rateAlertService } from '@/services/ratealert.service';
import { verificationService } from '@/services/verification.service';
import { apiKeyService } from '@/services/apikey.service';
import { adService } from '@/services/ad.service';
import { referralService } from '@/services/referral.service';
import { marketService } from '@/services/market.service';
import { limitService } from '@/services/limit.service';
import { UploadInvalidError } from '@/utils/error.util';

export const rateAlertsRouter = Router();
rateAlertsRouter.use(Auth.authenticate);
rateAlertsRouter.get('/', h(async (req, res) => ok(res, await rateAlertService.list(uid(req)))));
rateAlertsRouter.post('/', validateBody(rateAlertSchema), h(async (req, res) => created(res, await rateAlertService.create(uid(req), req.body))));
rateAlertsRouter.patch('/:id', validateParams(idParams), validateBody(z.object({ isActive: z.boolean() })), h(async (req, res) => ok(res, await rateAlertService.setActive(uid(req), param(req), req.body.isActive))));
rateAlertsRouter.delete('/:id', validateParams(idParams), h(async (req, res) => { await rateAlertService.remove(uid(req), param(req)); ok(res, { removed: true }); }));

// ── verification (multipart; documents go straight to private storage) ──
export const verificationRouter = Router();
verificationRouter.use(Auth.authenticate);
verificationRouter.get('/', h(async (req, res) => ok(res, await verificationService.myCases(uid(req)))));
verificationRouter.post('/', RL.upload, Auth.requireEmailVerified, uploadMany('documents', 5), h(async (req, res) => {
  const input = verificationSubmitSchema.parse({ ...req.body });
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const kinds: string[] = [].concat((req.body?.kinds as never) ?? []);
  if (!files.length || kinds.length !== files.length) throw new UploadInvalidError('Each document needs a matching "kinds" entry');
  created(res, await verificationService.submit(uid(req), input, files.map((f, i) => ({ kind: String(kinds[i]), buffer: f.buffer, mimetype: f.mimetype }))));
}));

// ── referrals ──
export const referralsRouter = Router();
referralsRouter.use(Auth.authenticate);
referralsRouter.get('/', h(async (req, res) => ok(res, await referralService.stats(uid(req)))));
referralsRouter.get('/list', validateQuery(pageQ), h(async (req, res) => {
  const q = req.query as never as z.infer<typeof pageQ>;
  paged(res, await referralService.list(uid(req), q.page, q.perPage), q.page, q.perPage);
}));

// ── advertising campaigns (owner side) ──
export const adsRouter = Router();
adsRouter.use(Auth.authenticate);
adsRouter.get('/', h(async (req, res) => ok(res, await adService.mine(uid(req)))));
adsRouter.post('/', validateBody(adCampaignSchema), h(async (req, res) => created(res, await adService.create(uid(req), req.body))));
adsRouter.put('/:id', validateParams(idParams), validateBody(adCampaignSchema), h(async (req, res) => ok(res, await adService.update(uid(req), param(req), req.body))));

// ── developer API keys (JWT only; never usable with an API key) ──
export const developerRouter = Router();
developerRouter.use(Auth.authenticate, Auth.forbidApiKeyAuth);
developerRouter.get('/keys', h(async (req, res) => ok(res, await apiKeyService.list(uid(req)))));
developerRouter.post('/keys', Auth.requireRecentAuth, validateBody(apiKeyCreateSchema), h(async (req, res) => created(res, await apiKeyService.create(uid(req), req.body))));
developerRouter.post('/keys/:id/rotate', Auth.requireRecentAuth, validateParams(idParams), h(async (req, res) => ok(res, await apiKeyService.rotate(uid(req), param(req)))));
developerRouter.delete('/keys/:id', Auth.requireRecentAuth, validateParams(idParams), h(async (req, res) => { await apiKeyService.revoke(uid(req), param(req)); ok(res, { revoked: true }); }));
developerRouter.get('/keys/:id/usage', validateParams(idParams), validateQuery(z.object({ days: z.coerce.number().int().min(1).max(90).default(30) })), h(async (req, res) => ok(res, await apiKeyService.usage(uid(req), param(req), (req.query as never as { days: number }).days))));

// ── my analytics / limits ──
export const insightsRouter = Router();
insightsRouter.use(Auth.authenticate);
insightsRouter.get('/limits', h(async (req, res) => ok(res, await limitService.forUser(uid(req)))));
insightsRouter.get('/geographic', h(async (req, res) => ok(res, await marketService.geographicActivity(uid(req), 7))));
