// src/routes/subscription.routes.ts
import { Router } from 'express';
import express from 'express';
import { SubscriptionController } from '@/controllers/subscription.controller';
import { authMiddleware } from '@/middleware/auth.middleware';
import { asyncHandler } from '@/utils/helpers.util';

const router = Router();
const ctrl   = new SubscriptionController();

// ── Public: Stripe webhook (raw body required) ────────────
// Register this BEFORE body parsers in app.ts:
// app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }), subscriptionRoutes)
router.post('/webhook', asyncHandler(ctrl.handleWebhook));

// ── Authenticated routes ──────────────────────────────────
router.use(authMiddleware);

router.get('/plans',   asyncHandler(ctrl.getPlans));
router.get('/current', asyncHandler(ctrl.getCurrentSubscription));
router.post('/checkout', asyncHandler(ctrl.createCheckout));
router.post('/portal',   asyncHandler(ctrl.createPortal));
router.post('/cancel',   asyncHandler(ctrl.cancelSubscription));

export default router;

/*
 * Register in src/routes/index.ts:
 *
 * import subscriptionRoutes from './subscription.routes';
 *
 * // Webhook — must use raw body, register BEFORE json middleware
 * app.post(
 *   '/api/webhooks/stripe',
 *   express.raw({ type: 'application/json' }),
 *   asyncHandler(new SubscriptionController().handleWebhook)
 * );
 *
 * // Authenticated subscription routes
 * router.use('/subscriptions', subscriptionRoutes);
 *
 * Add to .env:
 *   STRIPE_SECRET_KEY=sk_live_...
 *   STRIPE_PUBLISHABLE_KEY=pk_live_...
 *   STRIPE_WEBHOOK_SECRET=whsec_...
 *   STRIPE_PRICE_PREMIUM_MONTHLY=price_...
 *   STRIPE_PRICE_PREMIUM_YEARLY=price_...
 *   STRIPE_PRICE_BUSINESS_MONTHLY=price_...
 *   STRIPE_PRICE_BUSINESS_YEARLY=price_...
 *
 * Add to schema.prisma:
 *   model Subscription {
 *     id                   String   @id @default(auto()) @map("_id") @db.ObjectId
 *     userId               String   @db.ObjectId
 *     user                 User     @relation(fields: [userId], references: [id])
 *     stripeSubscriptionId String   @unique
 *     stripePriceId        String
 *     planId               String
 *     status               String   // ACTIVE | TRIALING | CANCELLED | PAST_DUE
 *     tier                 String   // PREMIUM | BUSINESS
 *     interval             String   // month | year
 *     amount               Float
 *     currency             String
 *     currentPeriodEnd     DateTime
 *     cancelAtPeriodEnd    Boolean  @default(false)
 *     createdAt            DateTime @default(now())
 *     updatedAt            DateTime @updatedAt
 *   }
 *
 *   // Add to User model:
 *   stripeCustomerId String?
 *   subscriptions    Subscription[]
 *
 * Run: npm install stripe
 */
