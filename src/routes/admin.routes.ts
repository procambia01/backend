import { Router, z, h, ok, created, paged, idParams, pageQ, param } from './_h';
import { AuthMiddleware as Auth } from '@/middleware/auth.middleware';
import { RoleMiddleware as Role } from '@/middleware/role.middleware';
import { RateLimitMiddleware as RL } from '@/middleware/rateLimit.middleware';
import { validateBody, validateParams, validateQuery } from '@/middleware/validate.middleware';
import { resolveDisputeSchema, objectId, currencyCode, PRODUCT_KINDS } from '@/contracts';
import { uid } from '@/lib/http';
import { adminService } from '@/services/admin.service';
import { currencyService } from '@/services/currency.service';
import { exchangeRateService } from '@/services/exchangeRate.service';
import { verificationService } from '@/services/verification.service';
import { disputeService } from '@/services/dispute.service';
import { riskService } from '@/services/risk.service';
import { adService } from '@/services/ad.service';
import { ratingService } from '@/services/rating.service';
import { referralService } from '@/services/referral.service';
import { apiKeyService } from '@/services/apikey.service';
import { ledgerService } from '@/services/ledger.service';
import { billingService } from '@/services/billing.service';
import { systemConfigService } from '@/services/system-config.service';

const router = Router();
router.use(Auth.authenticate, Auth.forbidApiKeyAuth, RL.admin, Role.requireStaff);

const actor = (req: Parameters<Parameters<typeof h>[0]>[0]) => ({ id: uid(req), role: req.user!.role });
const reason = z.object({ reason: z.string().trim().min(5).max(500) });
const until = z.object({ reason: z.string().trim().min(5).max(500), until: z.string().datetime().optional() });
const idOnly = idParams;

// ───────────── dashboard & audit ─────────────
router.get('/dashboard', h(async (_req, res) => ok(res, await adminService.dashboard())));
router.get('/audit-logs', Role.requireAdmin, validateQuery(pageQ.extend({ actorId: objectId.optional(), action: z.string().max(100).optional(), targetType: z.string().max(60).optional() })), h(async (req, res) => {
  const q = req.query as never as { page: number; perPage: number; actorId?: string; action?: string; targetType?: string };
  paged(res, await adminService.auditLogs(q), q.page, q.perPage);
}));

// ───────────── users ─────────────
router.get('/users', validateQuery(pageQ.extend({ search: z.string().max(100).optional(), role: z.enum(['USER', 'STAFF', 'ADMIN', 'SUPER_ADMIN']).optional(), status: z.enum(['banned', 'suspended', 'active']).optional() })), h(async (req, res) => {
  const q = req.query as never as Parameters<typeof adminService.listUsers>[0];
  paged(res, await adminService.listUsers(q), q.page, q.perPage);
}));
router.get('/users/:id', validateParams(idOnly), h(async (req, res) => ok(res, await adminService.getUser(param(req)))));
router.post('/users/:id/ban', Role.requireAdmin, validateParams(idOnly), validateBody(until), h(async (req, res) => { await adminService.ban(actor(req), param(req), req.body.reason, req.body.until ? new Date(req.body.until) : undefined); ok(res, { banned: true }); }));
router.post('/users/:id/unban', Role.requireAdmin, validateParams(idOnly), validateBody(reason), h(async (req, res) => { await adminService.unban(actor(req), param(req), req.body.reason); ok(res, { banned: false }); }));
router.post('/users/:id/suspend', validateParams(idOnly), validateBody(until), h(async (req, res) => { await adminService.suspend(actor(req), param(req), req.body.reason, req.body.until ? new Date(req.body.until) : undefined); ok(res, { suspended: true }); }));
router.post('/users/:id/unsuspend', validateParams(idOnly), validateBody(reason), h(async (req, res) => { await adminService.unsuspend(actor(req), param(req), req.body.reason); ok(res, { suspended: false }); }));
router.post('/users/:id/trading-restriction', validateParams(idOnly), validateBody(reason.extend({ restricted: z.boolean() })), h(async (req, res) => { await adminService.setTradingRestricted(actor(req), param(req), req.body.restricted, req.body.reason); ok(res, { restricted: req.body.restricted }); }));
router.post('/users/:id/role', Role.requireSuperAdmin, validateParams(idOnly), validateBody(reason.extend({ role: z.enum(['USER', 'STAFF', 'ADMIN']) })), h(async (req, res) => { await adminService.setRole(actor(req), param(req), req.body.role, req.body.reason); ok(res, { role: req.body.role }); }));
router.post('/users/:id/partner', Role.requireAdmin, validateParams(idOnly), validateBody(z.object({ isPartner: z.boolean() })), h(async (req, res) => ok(res, await adminService.setPartner(uid(req), param(req), req.body.isPartner))));

// ───────────── verification ─────────────
router.get('/verification', validateQuery(pageQ.extend({ status: z.enum(['SUBMITTED', 'UNDER_REVIEW']).default('SUBMITTED') })), h(async (req, res) => {
  const q = req.query as never as { status: 'SUBMITTED' | 'UNDER_REVIEW'; page: number; perPage: number };
  paged(res, await verificationService.queue(q.status, q.page, q.perPage), q.page, q.perPage);
}));
router.post('/verification/:id/start', validateParams(idOnly), h(async (req, res) => ok(res, await verificationService.startReview(param(req), uid(req)))));
router.post('/verification/:id/decision', validateParams(idOnly), validateBody(z.object({ decision: z.enum(['VERIFIED', 'REJECTED']), reason: z.string().trim().max(500).optional() }).refine((v) => v.decision === 'VERIFIED' || (v.reason && v.reason.length >= 5), { message: 'A rejection reason is required', path: ['reason'] })), h(async (req, res) => ok(res, await verificationService.decide(param(req), uid(req), req.body.decision, req.body.reason))));
router.post('/verification/documents/:id/url', validateParams(idOnly), validateBody(reason), h(async (req, res) => ok(res, await verificationService.documentUrl(param(req), uid(req), req.body.reason))));

// ───────────── disputes ─────────────
router.get('/disputes', validateQuery(pageQ.extend({ status: z.enum(['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED']).optional() })), h(async (req, res) => {
  const q = req.query as never as { status?: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'CLOSED'; page: number; perPage: number };
  paged(res, await disputeService.adminList(q), q.page, q.perPage);
}));
router.get('/disputes/:id', validateParams(idOnly), h(async (req, res) => ok(res, await disputeService.adminGet(param(req)))));
router.post('/disputes/:id/investigate', validateParams(idOnly), h(async (req, res) => ok(res, await disputeService.startInvestigation(uid(req), param(req)))));
router.post('/disputes/:id/resolve', validateParams(idOnly), validateBody(resolveDisputeSchema), h(async (req, res) => ok(res, await disputeService.resolve(uid(req), param(req), req.body))));
router.post('/disputes/:id/close', validateParams(idOnly), h(async (req, res) => ok(res, await disputeService.close(uid(req), param(req)))));
router.get('/disputes/evidence/:id/url', validateParams(idOnly), h(async (req, res) => ok(res, await disputeService.evidenceUrl(uid(req), true, param(req)))));

// ───────────── risk ─────────────
router.get('/risk', validateQuery(pageQ.extend({ status: z.enum(['OPEN', 'REVIEWING', 'DISMISSED', 'ACTIONED']).optional() })), h(async (req, res) => {
  const q = req.query as never as { status?: 'OPEN' | 'REVIEWING' | 'DISMISSED' | 'ACTIONED'; page: number; perPage: number };
  paged(res, await riskService.list(q.status, q.page, q.perPage), q.page, q.perPage);
}));
router.post('/risk/:id/review', validateParams(idOnly), validateBody(z.object({ decision: z.string().min(2).max(40), note: z.string().trim().max(500).optional() })), h(async (req, res) => ok(res, await riskService.review(param(req), uid(req), req.body.decision as never, req.body.note))));

// ───────────── ads / ratings / referrals ─────────────
router.get('/ads/review', validateQuery(pageQ), h(async (req, res) => { const q = req.query as never as { page: number; perPage: number }; paged(res, await adService.reviewQueue(q.page, q.perPage), q.page, q.perPage); }));
router.post('/ads/:id/review', validateParams(idOnly), validateBody(z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().max(500).optional() })), h(async (req, res) => ok(res, await adService.review(uid(req), param(req), req.body.decision, req.body.note))));
router.post('/ads/:id/pause', validateParams(idOnly), validateBody(z.object({ paused: z.boolean() })), h(async (req, res) => ok(res, await adService.setPaused(uid(req), param(req), req.body.paused))));
router.post('/ratings/:id/hide', validateParams(idOnly), validateBody(z.object({ hidden: z.boolean() })), h(async (req, res) => ok(res, await ratingService.hide(param(req), req.body.hidden))));
router.post('/referrals/:id/review', validateParams(idOnly), validateBody(reason.extend({ decision: z.enum(['APPROVE', 'REJECT']) })), h(async (req, res) => ok(res, await referralService.adminReview(param(req), uid(req), req.body.decision, req.body.reason))));

// ───────────── configuration (ADMIN+) ─────────────
const cfg = Router();
cfg.use(Role.requireAdmin);
router.use(cfg);

const currencySchema = z.object({ code: currencyCode, name: z.string().trim().min(2).max(80), symbol: z.string().trim().min(1).max(8), minorUnit: z.number().int().min(0).max(4), region: z.string().trim().min(2).max(40), isActive: z.boolean().optional(), isPopular: z.boolean().optional(), sortOrder: z.number().int().min(0).max(10000).optional() });
cfg.get('/currencies', h(async (_req, res) => ok(res, await currencyService.listAll())));
cfg.put('/currencies', validateBody(currencySchema), h(async (req, res) => ok(res, await currencyService.adminUpsert(uid(req), req.body))));
cfg.post('/currencies/:code/active', validateParams(z.object({ code: currencyCode })), validateBody(z.object({ isActive: z.boolean(), reason: z.string().trim().max(300).optional() })), h(async (req, res) => ok(res, await currencyService.adminSetActive(uid(req), param(req, 'code'), req.body.isActive, req.body.reason))));
cfg.post('/rates/refresh', h(async (_req, res) => ok(res, { updated: await exchangeRateService.refreshRates() })));

const productSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,48}$/), kind: z.enum(PRODUCT_KINDS), name: z.string().trim().min(2).max(100), description: z.string().trim().max(500).optional(),
  amountMinor: z.number().int().min(0).max(100_000_000), currency: currencyCode, interval: z.enum(['ONE_TIME', 'MONTH', 'YEAR']).optional(), durationHours: z.number().int().min(1).max(24 * 365).optional(),
  planTier: z.enum(['FREE', 'PREMIUM', 'BUSINESS']).optional(), placement: z.enum(['HOMEPAGE', 'MARKETPLACE_TOP', 'CURRENCY_PAIR']).optional(), trialDays: z.number().int().min(0).max(60).optional(),
  features: z.array(z.string().max(120)).max(20).optional(), config: z.record(z.unknown()).optional(), isActive: z.boolean().optional(), sortOrder: z.number().int().min(0).max(10000).optional(), reason: z.string().trim().max(300).optional(),
});
cfg.get('/products', h(async (_req, res) => ok(res, await adminService.listProducts())));
cfg.put('/products', validateBody(productSchema), h(async (req, res) => { const { reason: r, ...input } = req.body; ok(res, await adminService.upsertProduct(uid(req), input, r)); }));
cfg.post('/products/:code/active', validateParams(z.object({ code: z.string().min(3).max(48) })), validateBody(z.object({ isActive: z.boolean(), reason: z.string().trim().max(300).optional() })), h(async (req, res) => ok(res, await adminService.setProductActive(uid(req), param(req, 'code'), req.body.isActive, req.body.reason))));
cfg.get('/limit-policies', h(async (_req, res) => ok(res, await adminService.listLimitPolicies())));
cfg.put('/limit-policies/:key', validateParams(z.object({ key: z.string().min(3).max(40) })), validateBody(z.record(z.unknown())), h(async (req, res) => { const { reason: r, ...input } = req.body as Record<string, unknown>; ok(res, await adminService.upsertLimitPolicy(uid(req), param(req, 'key'), input, typeof r === 'string' ? r : undefined)); }));
cfg.get('/referral-rules', h(async (_req, res) => ok(res, await adminService.listReferralRules())));
cfg.put('/referral-rules', validateBody(z.object({ code: z.string().trim().min(3).max(40), name: z.string().trim().min(2).max(100), qualifyingAction: z.enum(['FIRST_COMPLETED_SWAP', 'VERIFIED_AND_SWAP', 'PAID_PLAN_PURCHASE']), minCompletedSwaps: z.number().int().min(0).max(100).optional(), rewardType: z.enum(['FIXED', 'PERCENT_OF_SERVICE_REVENUE']).optional(), rewardMinor: z.number().int().min(0).optional(), percentBps: z.number().int().min(0).max(10000).optional(), currency: currencyCode.optional(), isPartnerRule: z.boolean().optional(), monthlyCapPerReferrer: z.number().int().min(0).optional(), lifetimeCapPerReferrer: z.number().int().min(0).optional(), holdDays: z.number().int().min(0).max(180).optional(), isActive: z.boolean().optional() })), h(async (req, res) => ok(res, await adminService.upsertReferralRule(uid(req), req.body))));
cfg.get('/templates', h(async (_req, res) => ok(res, await adminService.listTemplates())));
cfg.put('/templates', validateBody(z.object({ type: z.string().min(2).max(60), locale: z.string().min(2).max(5), titleTemplate: z.string().min(1).max(200), bodyTemplate: z.string().min(1).max(1000), isActive: z.boolean().optional() })), h(async (req, res) => ok(res, await adminService.upsertTemplate(uid(req), req.body as never))));
cfg.get('/config', h(async (_req, res) => ok(res, await systemConfigService.list(false))));
cfg.put('/config/:key', validateParams(z.object({ key: z.string().min(3).max(80) })), validateBody(z.object({ value: z.string().max(500), reason: z.string().trim().max(300).optional() })), h(async (req, res) => ok(res, await systemConfigService.set(uid(req), param(req, 'key'), req.body.value, req.body.reason))));

// ───────────── money (CashMouver's own revenue only) ─────────────
cfg.get('/payments', validateQuery(pageQ.extend({ status: z.string().max(30).optional(), userId: objectId.optional(), kind: z.enum(PRODUCT_KINDS).optional() })), h(async (req, res) => {
  const q = req.query as never as Parameters<typeof adminService.listPayments>[0];
  paged(res, await adminService.listPayments(q), q.page, q.perPage);
}));
cfg.post('/payments/:id/refund', validateParams(idOnly), validateBody(reason.extend({ amountMinor: z.number().int().positive().optional() })), h(async (req, res) => ok(res, await billingService.adminRefund(uid(req), param(req), req.body.amountMinor, req.body.reason))));
cfg.get('/webhook-events', validateQuery(pageQ.extend({ status: z.string().max(20).optional() })), h(async (req, res) => { const q = req.query as never as { page: number; perPage: number; status?: string }; paged(res, await adminService.listWebhookEvents(q.page, q.perPage, q.status), q.page, q.perPage); }));
cfg.get('/ledger', validateQuery(pageQ.extend({ entryType: z.string().max(40).optional(), currency: currencyCode.optional() })), h(async (req, res) => { const q = req.query as never as { page: number; perPage: number; entryType?: never; currency?: string }; paged(res, await ledgerService.list(q.page, q.perPage, { entryType: q.entryType, currency: q.currency }), q.page, q.perPage); }));
cfg.get('/ledger/summary', validateQuery(z.object({ from: z.string().datetime(), to: z.string().datetime() })), h(async (req, res) => ok(res, await ledgerService.summary(new Date(String(req.query.from)), new Date(String(req.query.to))))));
cfg.post('/ledger/adjustments', Role.requireSuperAdmin, validateBody(z.object({ paymentId: objectId.optional(), direction: z.enum(['CREDIT', 'DEBIT']), amountMinor: z.number().int().positive(), currency: currencyCode, reason: z.string().trim().min(5).max(500), reversesId: objectId.optional() })), h(async (req, res) => created(res, await ledgerService.adjust(uid(req), req.body))));
cfg.get('/api-keys', validateQuery(pageQ), h(async (req, res) => { const q = req.query as never as { page: number; perPage: number }; paged(res, await apiKeyService.adminList(q.page, q.perPage), q.page, q.perPage); }));
cfg.delete('/api-keys/:id', validateParams(idOnly), validateBody(reason), h(async (req, res) => { await apiKeyService.revoke(uid(req), param(req), { admin: true, reason: req.body.reason }); ok(res, { revoked: true }); }));

export default router;
