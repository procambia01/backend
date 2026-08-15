import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import offerRoutes from './offer.routes';
import swapRoutes from './swap.routes';
import messageRoutes from './message.routes';
import ratingRoutes from './rating.routes';
import disputeRoutes from './dispute.routes';
import notificationRoutes from './notification.routes';
import transactionRoutes from './transaction.routes';
import locationRoutes from './location.routes';
import referralRoutes from './referral.routes';
import analyticsRoutes from './analytics.routes';
import adminRoutes from './admin.routes';
import webhookRoutes from './webhook.routes';
import subscriptionRoutes from './subscription.routes';
import partnerRoutes from './partner.routes';

const router = Router();

// API version prefix
const API_VERSION = '/v1';

// Mount routes
router.use(`${API_VERSION}/auth`, authRoutes);
router.use(`${API_VERSION}/users`, userRoutes);
router.use(`${API_VERSION}/offers`, offerRoutes);
router.use(`${API_VERSION}/swaps`, swapRoutes);
router.use(`${API_VERSION}/messages`, messageRoutes);
router.use(`${API_VERSION}/ratings`, ratingRoutes);
router.use(`${API_VERSION}/disputes`, disputeRoutes);
router.use(`${API_VERSION}/notifications`, notificationRoutes);
router.use(`${API_VERSION}/transactions`, transactionRoutes);
router.use(`${API_VERSION}/locations`, locationRoutes);
router.use(`${API_VERSION}/referrals`, referralRoutes);
router.use(`${API_VERSION}/analytics`, analyticsRoutes);
router.use(`${API_VERSION}/admin`, adminRoutes);
router.use(`${API_VERSION}/webhooks`, webhookRoutes);
router.use(`${API_VERSION}/subscriptions`, subscriptionRoutes);
router.use(`${API_VERSION}/partner`, partnerRoutes);

// API info route
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Currency Exchange API',
    version: '1.0.0',
    endpoints: {
      auth: `${API_VERSION}/auth`,
      users: `${API_VERSION}/users`,
      offers: `${API_VERSION}/offers`,
      swaps: `${API_VERSION}/swaps`,
      messages: `${API_VERSION}/messages`,
      ratings: `${API_VERSION}/ratings`,
      disputes: `${API_VERSION}/disputes`,
      notifications: `${API_VERSION}/notifications`,
      transactions: `${API_VERSION}/transactions`,
      locations: `${API_VERSION}/locations`,
      referrals: `${API_VERSION}/referrals`,
      analytics: `${API_VERSION}/analytics`,
      admin: `${API_VERSION}/admin`,
      webhooks: `${API_VERSION}/webhooks`,
      subscriptions: `${API_VERSION}/subscriptions`,
    },
  });
});

export default router;
