import Stripe from 'stripe';
import { newDb } from '../helpers/fake-db';

const db = newDb();
jest.mock('@/config/database', () => ({ prisma: db, default: db }));
jest.mock('@/config/redis', () => require('../helpers/mock-infra').redisStub());
jest.mock('@/services/notification.service', () => ({ notificationService: { notify: jest.fn(async () => 'n1') }, NOTIFICATION_ROUTES: {} }));
jest.mock('@/services/risk.service', () => ({ riskService: { onPaymentMismatch: jest.fn(async () => undefined) } }));
jest.mock('@/services/referral.service', () => ({ referralService: { onQualifyingEvent: jest.fn(async () => undefined) } }));
jest.mock('@/services/promotion.service', () => ({ promotionService: { grantBoost: jest.fn(async () => undefined), grantFeatured: jest.fn(async () => undefined) } }));
jest.mock('@/services/verification.service', () => ({ verificationService: { onFeePaid: jest.fn(async () => undefined) } }));
jest.mock('@/services/ad.service', () => ({ adService: { onPaid: jest.fn(async () => undefined) } }));
jest.mock('@/services/subscription.service', () => ({ subscriptionService: { syncById: jest.fn(async () => null), sync: jest.fn() } }));

import { constructWebhookEvent } from '@/services/stripe.client';
import { stripeWebhookService } from '@/services/stripe-webhook.service';
import { promotionService } from '@/services/promotion.service';
import { riskService } from '@/services/risk.service';
import { BadRequestError } from '@/utils/error.util';

const SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const sign = (payload: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) =>
  Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });

let n = 0;
const checkoutEvent = (payment: { id: string }, over: Record<string, unknown> = {}, type = 'checkout.session.completed', eventId = `evt_${++n}`) => ({
  id: eventId, object: 'event', type, livemode: false, created: Math.floor(Date.now() / 1000),
  data: { object: { id: `cs_${payment.id}`, object: 'checkout.session', mode: 'payment', payment_status: 'paid', amount_total: 499, currency: 'eur', payment_intent: 'pi_1', client_reference_id: payment.id, metadata: { paymentId: payment.id, userId: 'u1' }, ...over } },
}) as unknown as Stripe.Event;

const makePayment = (over: Record<string, unknown> = {}) =>
  db.seed('payment', { userId: 'u1', productCode: 'BOOST_3D', kind: 'BOOST', amountMinor: 499, currency: 'EUR', idempotencyKey: `k${++n}`, stripeCheckoutSessionId: null, fulfilledAt: null, targetId: 'offer1', ...over });

beforeEach(() => {
  db.tables.clear();
  db.seed('currency', { code: 'EUR', minorUnit: 2, isActive: true, name: 'Euro', symbol: '€', region: 'EUROPE', sortOrder: 1 });
  jest.clearAllMocks();
});

describe('Stripe webhook signature (raw body)', () => {
  const body = JSON.stringify({ id: 'evt_x', object: 'event', type: 'ping', data: { object: {} } });
  it('accepts a correctly signed raw body', () => {
    expect(constructWebhookEvent(Buffer.from(body), sign(body)).id).toBe('evt_x');
  });
  it('rejects a forged signature (wrong secret)', () => {
    expect(() => constructWebhookEvent(Buffer.from(body), sign(body, 'whsec_attacker'))).toThrow(BadRequestError);
  });
  it('rejects a tampered body', () => {
    expect(() => constructWebhookEvent(Buffer.from(body.replace('evt_x', 'evt_y')), sign(body))).toThrow(BadRequestError);
  });
  it('rejects a replayed event outside the timestamp tolerance', () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(() => constructWebhookEvent(Buffer.from(body), sign(body, SECRET, old))).toThrow(BadRequestError);
  });
  it('rejects a missing signature header', () => {
    expect(() => constructWebhookEvent(Buffer.from(body), undefined)).toThrow(BadRequestError);
  });
  it('refuses a re-serialised (non-raw) body: JSON.stringify(parsed) is not the signed text', () => {
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    expect(() => constructWebhookEvent(Buffer.from(pretty), sign(body))).toThrow(BadRequestError);
  });
  it('rejects a non-Buffer body', () => {
    expect(() => constructWebhookEvent(JSON.parse(body) as never, sign(body))).toThrow(BadRequestError);
  });
});

describe('Stripe webhook processing', () => {
  it('fulfils a paid checkout exactly once and books revenue once', async () => {
    const p = makePayment();
    const ev = checkoutEvent(p);
    expect(await stripeWebhookService.process(ev)).toBe('processed');
    expect(db.rows('payment')[0].status).toBe('SUCCEEDED');
    expect(db.rows('ledgerEntry')).toHaveLength(1);
    expect(db.rows('ledgerEntry')[0]).toMatchObject({ entryType: 'BOOST_PURCHASE', direction: 'CREDIT', amountMinor: 499, currency: 'EUR' });
    expect(promotionService.grantBoost).toHaveBeenCalledTimes(1);
  });

  it('a duplicate delivery of the same event is acknowledged without side effects', async () => {
    const p = makePayment();
    const ev = checkoutEvent(p);
    await stripeWebhookService.process(ev);
    expect(await stripeWebhookService.process(ev)).toBe('duplicate');
    expect(db.rows('stripeWebhookEvent')).toHaveLength(1);
    expect(db.rows('ledgerEntry')).toHaveLength(1);
    expect(promotionService.grantBoost).toHaveBeenCalledTimes(1);
  });

  it('two different events for the same payment still fulfil once (completed + async_succeeded)', async () => {
    const p = makePayment();
    await stripeWebhookService.process(checkoutEvent(p));
    await stripeWebhookService.process(checkoutEvent(p, {}, 'checkout.session.async_payment_succeeded'));
    expect(db.rows('ledgerEntry')).toHaveLength(1);
    expect(promotionService.grantBoost).toHaveBeenCalledTimes(1);
  });

  it('concurrent deliveries of one event are claimed by a single worker', async () => {
    const p = makePayment();
    const ev = checkoutEvent(p);
    const out = await Promise.all([stripeWebhookService.process(ev), stripeWebhookService.process(ev), stripeWebhookService.process(ev)]);
    expect(out.filter((o) => o === 'processed')).toHaveLength(1);
    expect(out.filter((o) => o === 'duplicate')).toHaveLength(2);
    expect(promotionService.grantBoost).toHaveBeenCalledTimes(1);
  });

  it('wrong AMOUNT: rejects, fails the payment, flags risk, grants nothing', async () => {
    const p = makePayment();
    const out = await stripeWebhookService.process(checkoutEvent(p, { amount_total: 1 }));
    expect(out).toBe('rejected');
    expect(db.rows('payment')[0]).toMatchObject({ status: 'FAILED' });
    expect(db.rows('payment')[0].failureReason).toContain('amount');
    expect(db.rows('ledgerEntry')).toHaveLength(0);
    expect(promotionService.grantBoost).not.toHaveBeenCalled();
    expect(riskService.onPaymentMismatch).toHaveBeenCalled();
  });

  it('wrong CURRENCY: rejects and grants nothing', async () => {
    const p = makePayment();
    expect(await stripeWebhookService.process(checkoutEvent(p, { currency: 'usd' }))).toBe('rejected');
    expect(db.rows('payment')[0].status).toBe('FAILED');
    expect(promotionService.grantBoost).not.toHaveBeenCalled();
  });

  it('metadata naming a different user: rejects', async () => {
    const p = makePayment();
    expect(await stripeWebhookService.process(checkoutEvent(p, { metadata: { paymentId: p.id, userId: 'someone-else' } }))).toBe('rejected');
    expect(promotionService.grantBoost).not.toHaveBeenCalled();
  });

  it('a session id that belongs to another payment: rejects', async () => {
    const p = makePayment({ stripeCheckoutSessionId: 'cs_original' });
    expect(await stripeWebhookService.process(checkoutEvent(p, { id: 'cs_other' }))).toBe('rejected');
    expect(db.rows('ledgerEntry')).toHaveLength(0);
  });

  it('an unknown payment is rejected without throwing (no endless Stripe retries)', async () => {
    expect(await stripeWebhookService.process(checkoutEvent({ id: 'a'.repeat(24) }))).toBe('rejected');
  });

  it('a rejected event is not retried when Stripe redelivers it', async () => {
    const p = makePayment();
    const ev = checkoutEvent(p, { amount_total: 1 });
    await stripeWebhookService.process(ev);
    expect(await stripeWebhookService.process(ev)).toBe('duplicate');
  });

  it('payment failure marks the payment FAILED and a later success recovers it', async () => {
    const p = makePayment({ stripePaymentIntentId: 'pi_1' });
    const failed = { id: 'evt_f', object: 'event', type: 'payment_intent.payment_failed', livemode: false, created: 1, data: { object: { id: 'pi_1', metadata: { paymentId: p.id }, last_payment_error: { code: 'card_declined' } } } } as unknown as Stripe.Event;
    expect(await stripeWebhookService.process(failed)).toBe('processed');
    expect(db.rows('payment')[0]).toMatchObject({ status: 'FAILED', failureReason: 'card_declined' });
    expect(db.rows('ledgerEntry')).toHaveLength(0);

    await stripeWebhookService.process(checkoutEvent(p));
    expect(db.rows('payment')[0].status).toBe('SUCCEEDED');
    expect(db.rows('ledgerEntry')).toHaveLength(1);
  });

  it('a payment_failed event cannot downgrade an already successful payment', async () => {
    const p = makePayment({ stripePaymentIntentId: 'pi_1' });
    await stripeWebhookService.process(checkoutEvent(p));
    const failed = { id: 'evt_f2', object: 'event', type: 'payment_intent.payment_failed', livemode: false, created: 1, data: { object: { id: 'pi_1', metadata: { paymentId: p.id } } } } as unknown as Stripe.Event;
    await stripeWebhookService.process(failed);
    expect(db.rows('payment')[0].status).toBe('SUCCEEDED');
  });

  it('an expired checkout session expires the pending payment', async () => {
    const p = makePayment();
    await stripeWebhookService.process(checkoutEvent(p, {}, 'checkout.session.expired'));
    expect(db.rows('payment')[0].status).toBe('EXPIRED');
  });

  it('unhandled event types are recorded as ignored', async () => {
    const ev = { id: 'evt_unknown', object: 'event', type: 'customer.created', livemode: false, created: 1, data: { object: { id: 'cus_1' } } } as unknown as Stripe.Event;
    expect(await stripeWebhookService.process(ev)).toBe('ignored');
    expect(db.rows('stripeWebhookEvent')[0].status).toBe('IGNORED');
  });

  it('unpaid (delayed) sessions wait instead of granting the service', async () => {
    const p = makePayment();
    await stripeWebhookService.process(checkoutEvent(p, { payment_status: 'unpaid' }));
    expect(db.rows('payment')[0].status).toBe('PROCESSING');
    expect(promotionService.grantBoost).not.toHaveBeenCalled();
  });
});
