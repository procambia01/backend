import { Router, z, h, ok, paged, idParams, pageQ, param } from './_h';
import { AuthMiddleware as Auth } from '@/middleware/auth.middleware';
import { validateParams, validateQuery } from '@/middleware/validate.middleware';
import { uid } from '@/lib/http';
import { notificationService } from '@/services/notification.service';

const router = Router();
router.use(Auth.authenticate);
const q = pageQ.extend({ unreadOnly: z.coerce.boolean().optional() });

router.get('/', validateQuery(q), h(async (req, res) => {
  const p = req.query as never as z.infer<typeof q>;
  paged(res, await notificationService.list(uid(req), p.page, p.perPage, !!p.unreadOnly), p.page, p.perPage);
}));
router.get('/unread-count', h(async (req, res) => ok(res, { unread: await notificationService.unreadCount(uid(req)) })));
router.post('/read-all', h(async (req, res) => ok(res, await notificationService.markAllRead(uid(req)))));
router.post('/:id/read', validateParams(idParams), h(async (req, res) => ok(res, await notificationService.markRead(uid(req), param(req)))));
router.delete('/:id', validateParams(idParams), h(async (req, res) => { await notificationService.remove(uid(req), param(req)); ok(res, { removed: true }); }));
export default router;
