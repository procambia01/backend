// src/routes/subscription.routes.ts
import { Router } from 'express';
import { SubscriptionController } from '@/controllers/subscription.controller';
import { authenticate } from '@/middleware/auth.middleware';
import { asyncHandler } from '@/middleware/error.middleware';

const router = Router();
const ctrl   = new SubscriptionController();

// ── Public: Stripe webhook (raw body required) ────────────
// NOTE: the raw-body parser for this path is registered in app.ts
// BEFORE express.json(), since Stripe signature verification needs
// the exact raw request bytes. See app.ts initializeMiddlewares().
router.post('/webhook', asyncHandler(ctrl.handleWebhook));

// ── Authenticated routes ──────────────────────────────────
router.use(authenticate);

router.get('/plans',   asyncHandler(ctrl.getPlans));
router.get('/current', asyncHandler(ctrl.getCurrentSubscription));
router.post('/checkout', asyncHandler(ctrl.createCheckout));
router.post('/portal',   asyncHandler(ctrl.createPortal));
router.post('/cancel',   asyncHandler(ctrl.cancelSubscription));

export default router;
