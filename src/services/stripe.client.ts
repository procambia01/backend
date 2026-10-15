import Stripe from 'stripe';
import { config } from '@/config/env';
import { ServiceUnavailableError, BadRequestError } from '@/utils/error.util';

let client: Stripe | null = null;
let override: Stripe | null = null;

/** Test hook: inject a fake Stripe. */
export function __setStripeForTests(fake: Stripe | null) {
  override = fake;
}

export function stripe(): Stripe {
  if (override) return override;
  const key = config.payment.stripe.secretKey;
  if (!key) throw new ServiceUnavailableError('Payments are not configured');
  client ??= new Stripe(key, { apiVersion: '2025-02-24.acacia', maxNetworkRetries: 2, appInfo: { name: 'CashMouver API' } });
  return client;
}

/**
 * Official signature verification over the RAW request bytes.
 * `rawBody` must be the exact Buffer received; a re-serialised JSON body would never verify.
 */
export function constructWebhookEvent(rawBody: Buffer, signature: string | undefined, secret = config.payment.stripe.webhookSecret): Stripe.Event {
  if (!secret) throw new ServiceUnavailableError('Webhook secret is not configured');
  if (!signature) throw new BadRequestError('Missing Stripe signature');
  if (!Buffer.isBuffer(rawBody)) throw new BadRequestError('Webhook body must be the raw request body');
  try {
    // Stripe's helper does an HMAC-SHA256 compare in constant time and enforces a 5 minute timestamp tolerance (anti-replay).
    return Stripe.webhooks.constructEvent(rawBody, signature, secret, 300);
  } catch {
    throw new BadRequestError('Invalid webhook signature');
  }
}
