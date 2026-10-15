import express, { Router } from 'express';
import { stripeWebhookService } from '@/services/stripe-webhook.service';
import ResponseUtil from '@/utils/response.util';
import logger from '@/utils/logger.util';
import { BadRequestError } from '@/utils/error.util';

/**
 * Stripe webhook. Mounted in app.ts BEFORE express.json() with express.raw,
 * so `req.body` is the untouched Buffer the signature was computed over.
 * Signature failure → 400. Processing failure → 500 so Stripe retries.
 * Duplicates are acknowledged with 200 (idempotent on StripeWebhookEvent.stripeEventId).
 */
const router = Router();
router.post('/stripe', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const raw = req.body as unknown;
  if (!Buffer.isBuffer(raw) || raw.length === 0) return ResponseUtil.error(res, 400, 'WEBHOOK_INVALID', 'Missing webhook body');
  let outcome;
  try {
    outcome = await stripeWebhookService.handleRaw(raw, req.get('stripe-signature'));
  } catch (error) {
    const e = error as { message?: string };
    if (error instanceof BadRequestError) {
      logger.warn('Rejected Stripe webhook with an invalid signature', { ip: req.ip });
      return ResponseUtil.error(res, 400, 'WEBHOOK_INVALID', 'Invalid signature');
    }
    logger.error('Stripe webhook processing failed', { message: e?.message });
    return ResponseUtil.error(res, 500, 'WEBHOOK_FAILED', 'Webhook processing failed');
  }
  return ResponseUtil.success(res, { received: true, outcome });
});
export default router;
