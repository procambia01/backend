import { Router, z, h, ok, created, paged, idParams, pageQ, param } from './_h';
import { AuthMiddleware as Auth } from '@/middleware/auth.middleware';
import { RateLimitMiddleware as RL } from '@/middleware/rateLimit.middleware';
import { validateBody, validateParams, validateQuery } from '@/middleware/validate.middleware';
import { uploadSingle } from '@/middleware/upload.middleware';
import { createSwapSchema, cancelSwapSchema, rejectSwapSchema, confirmSwapSchema, extendSwapSchema, proposeMeetupSchema, sendMessageSchema, editMessageSchema, reportSchema, createDisputeSchema, objectId } from '@/contracts';
import { uid } from '@/lib/http';
import { swapService } from '@/services/swap.service';
import { meetupService } from '@/services/meetup.service';
import { messageService } from '@/services/message.service';
import { ratingService } from '@/services/rating.service';
import { disputeService } from '@/services/dispute.service';
import { UploadInvalidError } from '@/utils/error.util';
import { file } from './_h';

const router = Router();
router.use(Auth.authenticate);

const listQuery = pageQ.extend({ status: z.enum(['PENDING', 'AGREED', 'IN_PROGRESS', 'CONFIRMING', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'ACTIVE']).optional() });
const rateSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
  punctuality: z.number().int().min(1).max(5).optional(),
  communication: z.number().int().min(1).max(5).optional(),
  professionalism: z.number().int().min(1).max(5).optional(),
  safety: z.number().int().min(1).max(5).optional(),
});
const meetupParams = z.object({ meetupId: objectId });
const messageParams = z.object({ messageId: objectId });
const messagesQuery = pageQ;

// ── swaps ──
router.get('/', validateQuery(listQuery), h(async (req, res) => {
  const q = req.query as never as z.infer<typeof listQuery>;
  paged(res, await swapService.list(uid(req), q), q.page, q.perPage);
}));
router.post('/', Auth.requireEmailVerified, RL.initiateSwap, validateBody(createSwapSchema), h(async (req, res) => created(res, await swapService.create(uid(req), req.body))));
router.get('/:id', validateParams(idParams), h(async (req, res) => ok(res, await swapService.getForUser(uid(req), param(req)))));
router.get('/:id/events', validateParams(idParams), h(async (req, res) => ok(res, await swapService.events(uid(req), param(req)))));
router.post('/:id/accept', validateParams(idParams), h(async (req, res) => ok(res, await swapService.accept(uid(req), param(req)))));
router.post('/:id/reject', validateParams(idParams), validateBody(rejectSwapSchema), h(async (req, res) => ok(res, await swapService.reject(uid(req), param(req), req.body.reason))));
router.post('/:id/cancel', validateParams(idParams), validateBody(cancelSwapSchema), h(async (req, res) => ok(res, await swapService.cancel(uid(req), param(req), req.body.reason))));
router.post('/:id/start', validateParams(idParams), h(async (req, res) => ok(res, await swapService.startAsParticipant(uid(req), param(req)))));
router.post('/:id/confirm', validateParams(idParams), validateBody(confirmSwapSchema), h(async (req, res) => ok(res, await swapService.confirm(uid(req), param(req), req.body))));
router.post('/:id/extend', validateParams(idParams), validateBody(extendSwapSchema), h(async (req, res) => ok(res, await swapService.extend(uid(req), param(req), req.body.hours))));

// ── meetups ──
router.get('/:id/meetup', validateParams(idParams), h(async (req, res) => ok(res, await meetupService.current(uid(req), param(req)))));
router.get('/:id/meetups', validateParams(idParams), h(async (req, res) => ok(res, await meetupService.history(uid(req), param(req)))));
router.post('/:id/meetups', validateParams(idParams), validateBody(proposeMeetupSchema), h(async (req, res) => created(res, await meetupService.propose(uid(req), param(req), req.body))));
router.post('/meetups/:meetupId/accept', validateParams(meetupParams), h(async (req, res) => ok(res, await meetupService.accept(uid(req), param(req, 'meetupId')))));
router.post('/meetups/:meetupId/cancel', validateParams(meetupParams), h(async (req, res) => ok(res, await meetupService.cancel(uid(req), param(req, 'meetupId')))));
router.post('/meetups/:meetupId/check-in', validateParams(meetupParams), h(async (req, res) => ok(res, await meetupService.checkIn(uid(req), param(req, 'meetupId')))));
router.post('/meetups/:meetupId/check-out', validateParams(meetupParams), h(async (req, res) => ok(res, await meetupService.checkOut(uid(req), param(req, 'meetupId')))));

// ── chat (messageService owns creation) ──
router.get('/:id/messages', validateParams(idParams), validateQuery(messagesQuery), h(async (req, res) => {
  const q = req.query as never as { page: number; perPage: number };
  paged(res, await messageService.list(uid(req), param(req), q.page, q.perPage), q.page, q.perPage);
}));
router.post('/:id/messages', RL.sendMessage, validateParams(idParams), validateBody(sendMessageSchema.pick({ content: true })), h(async (req, res) => created(res, await messageService.send(uid(req), param(req), req.body.content))));
router.post('/:id/messages/image', RL.upload, RL.sendMessage, validateParams(idParams), uploadSingle('image'), h(async (req, res) => {
  const f = file(req);
  if (!f) throw new UploadInvalidError('An image file is required');
  created(res, await messageService.sendImage(uid(req), param(req), f, typeof req.body?.caption === 'string' ? req.body.caption : undefined));
}));
router.post('/:id/messages/read', validateParams(idParams), h(async (req, res) => ok(res, { read: await messageService.markRead(uid(req), param(req)) })));
router.patch('/messages/:messageId', validateParams(messageParams), validateBody(editMessageSchema), h(async (req, res) => ok(res, await messageService.edit(uid(req), param(req, 'messageId'), req.body.content))));
router.delete('/messages/:messageId', validateParams(messageParams), h(async (req, res) => { await messageService.remove(uid(req), param(req, 'messageId')); ok(res, { removed: true }); }));
router.post('/messages/:messageId/report', RL.report, validateParams(messageParams), validateBody(reportSchema), h(async (req, res) => { await messageService.report(uid(req), param(req, 'messageId'), req.body.reason); created(res, { reported: true }); }));
router.get('/messages/:messageId/attachments/:index', validateParams(messageParams.extend({ index: z.coerce.number().int().min(0).max(5) })), h(async (req, res) => ok(res, await messageService.attachmentUrl(uid(req), param(req, 'messageId'), Number(req.params.index)))));

// ── rating ──
router.post('/:id/rating', validateParams(idParams), validateBody(rateSchema), h(async (req, res) => created(res, await ratingService.rate(uid(req), param(req), req.body))));

// ── dispute shortcut (the swap participant opens one against the swap) ──
router.post('/:id/dispute', RL.report, validateParams(idParams), validateBody(createDisputeSchema.omit({ swapId: true })), h(async (req, res) => created(res, await disputeService.open(uid(req), { swapId: param(req), ...req.body }))));

export default router;
