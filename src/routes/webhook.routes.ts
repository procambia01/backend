
// backend/src/routes/webhook.routes.ts
import { Router as WebhookRouter } from 'express';
import { WebhookController } from '@/controllers/webhook.controller';
import { asyncHandler } from '@/middleware/error.middleware';

const webhookRouter = WebhookRouter();
const webhookController = new WebhookController();

// Payment webhooks
webhookRouter.post('/stripe', asyncHandler(webhookController.handleStripeWebhook));
webhookRouter.post('/paystack', asyncHandler(webhookController.handlePaystackWebhook));
webhookRouter.post('/flutterwave', asyncHandler(webhookController.handleFlutterwaveWebhook));

export { webhookRouter as default };