import { Router } from 'express';
import { RateLimitMiddleware as RL } from '@/middleware/rateLimit.middleware';
import authRoutes from './auth.routes';
import usersRoutes from './users.routes';
import offersRoutes from './offers.routes';
import swapsRoutes from './swaps.routes';
import conversationsRoutes from './conversations.routes';
import disputesRoutes from './disputes.routes';
import notificationsRoutes from './notifications.routes';
import billingRoutes from './billing.routes';
import publicRoutes from './public.routes';
import partnerRoutes from './partner.routes';
import adminRoutes from './admin.routes';
import { rateAlertsRouter, verificationRouter, referralsRouter, adsRouter, developerRouter, insightsRouter } from './services-misc.routes';

/** Everything except the Stripe webhook (mounted separately with a raw body parser). */
const router = Router();
router.use(RL.general);

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/offers', offersRoutes);
router.use('/swaps', swapsRoutes);
router.use('/conversations', conversationsRoutes);
router.use('/disputes', disputesRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/billing', billingRoutes);
router.use('/rate-alerts', rateAlertsRouter);
router.use('/verification', verificationRouter);
router.use('/referrals', referralsRouter);
router.use('/advertising', adsRouter);
router.use('/developer', developerRouter);
router.use('/insights', insightsRouter);
router.use('/partner', partnerRoutes);
router.use('/admin', adminRoutes);
router.use('/', publicRoutes);

export default router;
