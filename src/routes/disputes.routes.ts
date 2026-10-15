import { Router, z, h, ok, created, paged, idParams, pageQ, param, file } from './_h';
import { AuthMiddleware as Auth } from '@/middleware/auth.middleware';
import { RateLimitMiddleware as RL } from '@/middleware/rateLimit.middleware';
import { validateBody, validateParams, validateQuery } from '@/middleware/validate.middleware';
import { uploadSingle } from '@/middleware/upload.middleware';
import { createDisputeSchema, objectId } from '@/contracts';
import { uid } from '@/lib/http';
import { disputeService } from '@/services/dispute.service';
import { UploadInvalidError } from '@/utils/error.util';

const router = Router();
router.use(Auth.authenticate);
const evidenceType = z.enum(['PHOTO', 'SCREENSHOT', 'DOCUMENT', 'CHAT_EXPORT', 'OTHER']);
const commentSchema = z.object({ note: z.string().trim().min(2).max(1000) });

router.get('/', validateQuery(pageQ), h(async (req, res) => {
  const q = req.query as never as z.infer<typeof pageQ>;
  paged(res, await disputeService.mine(uid(req), q.page, q.perPage), q.page, q.perPage);
}));
router.post('/', RL.report, validateBody(createDisputeSchema), h(async (req, res) => created(res, await disputeService.open(uid(req), req.body))));
router.get('/:id', validateParams(idParams), h(async (req, res) => ok(res, await disputeService.get(uid(req), param(req)))));
router.post('/:id/comments', validateParams(idParams), validateBody(commentSchema), h(async (req, res) => created(res, await disputeService.comment(uid(req), param(req), req.body.note))));
router.post('/:id/evidence', RL.upload, validateParams(idParams), uploadSingle('file'), h(async (req, res) => {
  const f = file(req);
  if (!f) throw new UploadInvalidError('A file is required');
  const type = evidenceType.parse(req.body?.type ?? 'OTHER');
  created(res, await disputeService.addEvidence(uid(req), param(req), f, type, typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : undefined));
}));
router.get('/evidence/:evidenceId/url', validateParams(z.object({ evidenceId: objectId })), h(async (req, res) => ok(res, await disputeService.evidenceUrl(uid(req), req.user!.role !== 'USER', param(req, 'evidenceId')))));

export default router;
