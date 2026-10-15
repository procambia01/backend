import { Router, z, h, ok, paged, pageQ } from './_h';
import { AuthMiddleware as Auth } from '@/middleware/auth.middleware';
import { validateQuery } from '@/middleware/validate.middleware';
import { uid } from '@/lib/http';
import { messageService } from '@/services/message.service';

const router = Router();
router.use(Auth.authenticate);
router.get('/', validateQuery(pageQ), h(async (req, res) => {
  const q = req.query as never as z.infer<typeof pageQ>;
  paged(res, await messageService.conversations(uid(req), q.page, q.perPage), q.page, q.perPage);
}));
router.get('/unread-count', h(async (req, res) => ok(res, { unread: await messageService.unreadTotal(uid(req)) })));
export default router;
