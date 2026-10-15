import type { Prisma } from '@prisma/client';
import type Stripe from 'stripe';
import { prisma } from '@/config/database';
import { fromStripeAmount } from '@/lib/money';
import logger from '@/utils/logger.util';
import { currencyService } from './currency.service';
import { ledgerService } from './ledger.service';
import { NonRetryableWebhookError, paymentFulfillment } from './payment-fulfillment.service';
import { promotionService } from './promotion.service';
import { constructWebhookEvent, stripe } from './stripe.client';
import { subscriptionService } from './subscription.service';

const STUCK_AFTER_MS = 5 * 60_000;
export type WebhookOutcome = 'processed' | 'ignored' | 'duplicate' | 'rejected';

const idOf = (v: string | { id: string } | null | undefined): string | null => (v ? (typeof v === 'string' ? v : v.id) : null);
const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';

/**
 * Stripe webhook pipeline:
 *   1. verify signature on the RAW bytes  2. claim the event id (unique)
 *   3. process once                        4. record the outcome
 * A duplicate or replayed event is acknowledged without side effects.
 */
export class StripeWebhookService {
  async handleRaw(rawBody: Buffer, signature: string | undefined): Promise<WebhookOutcome> {
    const event = constructWebhookEvent(rawBody, signature);
    return this.process(event);
  }

  /** Returns false when someone else already owns / finished this event. */
  private async claim(event: Stripe.Event): Promise<boolean> {
    const obj = event.data.object as { id?: string };
    try {
      await prisma.stripeWebhookEvent.create({
        data: { stripeEventId: event.id, eventType: event.type, livemode: event.livemode, objectId: obj?.id ?? null, status: 'PROCESSING', attempts: 1, payload: { object: obj?.id ?? null, type: event.type, created: event.created } as Prisma.InputJsonValue },
      });
      return true;
    } catch (error) {
      if (!isUnique(error)) throw error;
    }
    const existing = await prisma.stripeWebhookEvent.findUnique({ where: { stripeEventId: event.id } });
    if (!existing) return false;
    if (existing.status === 'PROCESSED' || existing.status === 'IGNORED') return false;
    if (existing.status === 'FAILED') {
      if (existing.error?.startsWith('NON_RETRYABLE')) return false;
      const r = await prisma.stripeWebhookEvent.updateMany({ where: { id: existing.id, status: 'FAILED' }, data: { status: 'PROCESSING', attempts: { increment: 1 } } });
      return r.count === 1;
    }
    // PROCESSING: only take over an abandoned attempt.
    if (Date.now() - existing.receivedAt.getTime() > STUCK_AFTER_MS) {
      const r = await prisma.stripeWebhookEvent.updateMany({ where: { id: existing.id, status: 'PROCESSING', attempts: existing.attempts }, data: { attempts: { increment: 1 }, receivedAt: new Date() } });
      return r.count === 1;
    }
    return false;
  }

  async process(event: Stripe.Event): Promise<WebhookOutcome> {
    if (!(await this.claim(event))) return 'duplicate';
    try {
      const handled = await this.dispatch(event);
      await prisma.stripeWebhookEvent.update({ where: { stripeEventId: event.id }, data: { status: handled ? 'PROCESSED' : 'IGNORED', processedAt: new Date(), error: null } });
      return handled ? 'processed' : 'ignored';
    } catch (error) {
      if (error instanceof NonRetryableWebhookError) {
        await prisma.stripeWebhookEvent.update({ where: { stripeEventId: event.id }, data: { status: 'FAILED', processedAt: new Date(), error: `NON_RETRYABLE:${error.code}` } });
        logger.error('stripe event rejected', { eventId: event.id, type: event.type, code: error.code });
        return 'rejected';
      }
      await prisma.stripeWebhookEvent.update({ where: { stripeEventId: event.id }, data: { status: 'FAILED', error: (error as Error).message.slice(0, 300) } }).catch(() => undefined);
      logger.error('stripe event failed (will be retried)', { eventId: event.id, type: event.type, message: (error as Error).message });
      throw error; // 5xx → Stripe retries with backoff
    }
  }

  private async dispatch(event: Stripe.Event): Promise<boolean> {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        return this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      case 'checkout.session.async_payment_failed':
        return this.onCheckoutFailed(event.data.object as Stripe.Checkout.Session);
      case 'checkout.session.expired':
        return this.onCheckoutExpired(event.data.object as Stripe.Checkout.Session);
      case 'payment_intent.payment_failed':
        return this.onPaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        return this.onInvoicePaid(event.data.object as Stripe.Invoice);
      case 'invoice.payment_failed':
        return this.onInvoiceFailed(event.data.object as Stripe.Invoice);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await subscriptionService.syncById(sub.id, sub);
        return true;
      }
      case 'charge.refunded':
        return this.onChargeRefunded(event.data.object as Stripe.Charge);
      default:
        return false;
    }
  }

  // ───────────── handlers ─────────────

  private async findPaymentForSession(session: Stripe.Checkout.Session) {
    const paymentId = session.metadata?.paymentId ?? session.client_reference_id;
    if (paymentId && /^[a-f0-9]{24}$/i.test(paymentId)) {
      const p = await prisma.payment.findUnique({ where: { id: paymentId } });
      if (p) return p;
    }
    return prisma.payment.findFirst({ where: { stripeCheckoutSessionId: session.id } });
  }

  private async onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<boolean> {
    const payment = await this.findPaymentForSession(session);
    if (!payment) throw new NonRetryableWebhookError('Checkout session has no matching payment', 'UNKNOWN_PAYMENT');
    if (payment.stripeCheckoutSessionId && payment.stripeCheckoutSessionId !== session.id) {
      throw new NonRetryableWebhookError('Session does not belong to this payment', 'SESSION_MISMATCH');
    }

    if (session.mode === 'subscription') {
      // Revenue and entitlement are driven by invoice.paid / customer.subscription.*; just link.
      const subId = idOf(session.subscription);
      if (subId) {
        await prisma.payment.updateMany({ where: { id: payment.id, status: { in: ['REQUIRES_PAYMENT', 'PROCESSING'] } }, data: { stripeSubscriptionId: subId, status: 'PROCESSING' } });
        await subscriptionService.syncById(subId);
      }
      return true;
    }

    if (session.payment_status === 'paid') {
      await paymentFulfillment.fulfill(payment.id, {
        amountPaid: session.amount_total ?? -1,
        currency: session.currency ?? '',
        paymentIntentId: idOf(session.payment_intent),
        checkoutSessionId: session.id,
        customerUserId: session.metadata?.userId ?? null,
      });
    } else {
      // Delayed payment method: wait for async_payment_succeeded / failed.
      await prisma.payment.updateMany({ where: { id: payment.id, status: 'REQUIRES_PAYMENT' }, data: { status: 'PROCESSING', stripePaymentIntentId: idOf(session.payment_intent) ?? undefined } });
    }
    return true;
  }

  private async onCheckoutFailed(session: Stripe.Checkout.Session): Promise<boolean> {
    const payment = await this.findPaymentForSession(session);
    if (!payment) return false;
    await paymentFulfillment.fail(payment.id, 'ASYNC_PAYMENT_FAILED');
    return true;
  }

  private async onCheckoutExpired(session: Stripe.Checkout.Session): Promise<boolean> {
    const payment = await this.findPaymentForSession(session);
    if (!payment) return false;
    await prisma.payment.updateMany({ where: { id: payment.id, status: 'REQUIRES_PAYMENT' }, data: { status: 'EXPIRED' } });
    if (payment.kind === 'ADVERTISING' && payment.targetId) {
      await prisma.adCampaign.updateMany({ where: { id: payment.targetId, status: 'PENDING_PAYMENT' }, data: { status: 'DRAFT' } });
    }
    return true;
  }

  private async onPaymentIntentFailed(pi: Stripe.PaymentIntent): Promise<boolean> {
    const paymentId = pi.metadata?.paymentId;
    const payment = paymentId && /^[a-f0-9]{24}$/i.test(paymentId) ? await prisma.payment.findUnique({ where: { id: paymentId } }) : await prisma.payment.findFirst({ where: { stripePaymentIntentId: pi.id } });
    if (!payment) return false;
    await paymentFulfillment.fail(payment.id, pi.last_payment_error?.code ?? 'PAYMENT_FAILED');
    return true;
  }

  private async onInvoicePaid(invoice: Stripe.Invoice): Promise<boolean> {
    const subscriptionId = idOf(invoice.subscription);
    if (!subscriptionId) return false; // one-time payments are handled via checkout
    const subRow = await subscriptionService.syncById(subscriptionId);
    if (!subRow) throw new NonRetryableWebhookError('Invoice for unknown subscription', 'UNKNOWN_SUBSCRIPTION');

    // First invoice → the checkout Payment; renewals → a new Payment keyed by invoice id.
    let payment = await prisma.payment.findFirst({ where: { stripeSubscriptionId: subscriptionId, stripeInvoiceId: null, kind: subRow.kind, userId: subRow.userId, status: { in: ['PROCESSING', 'REQUIRES_PAYMENT'] } }, orderBy: { createdAt: 'desc' } });
    if (!payment) {
      const product = await prisma.serviceProduct.findUnique({ where: { code: subRow.productCode } });
      if (!product) throw new NonRetryableWebhookError('Unknown product', 'UNKNOWN_PRODUCT');
      try {
        payment = await prisma.payment.create({
          data: { userId: subRow.userId, productId: product.id, productCode: product.code, kind: product.kind, amountMinor: subRow.amountMinor, currency: subRow.currency, idempotencyKey: `invoice:${invoice.id}`, stripeSubscriptionId: subscriptionId, stripeInvoiceId: invoice.id },
        });
      } catch (e) {
        if (!isUnique(e)) throw e;
        payment = await prisma.payment.findUniqueOrThrow({ where: { idempotencyKey: `invoice:${invoice.id}` } });
      }
    }
    await paymentFulfillment.fulfill(payment.id, {
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      paymentIntentId: idOf(invoice.payment_intent),
      invoiceId: invoice.id,
      subscriptionId,
    });
    return true;
  }

  private async onInvoiceFailed(invoice: Stripe.Invoice): Promise<boolean> {
    const subscriptionId = idOf(invoice.subscription);
    if (!subscriptionId) return false;
    const row = await subscriptionService.syncById(subscriptionId);
    if (!row) return false;
    const payment = await prisma.payment.findFirst({ where: { stripeSubscriptionId: subscriptionId, status: { in: ['PROCESSING', 'REQUIRES_PAYMENT'] } }, orderBy: { createdAt: 'desc' } });
    if (payment) await paymentFulfillment.fail(payment.id, 'INVOICE_PAYMENT_FAILED');
    else {
      const { notificationService } = await import('./notification.service');
      await notificationService.notify({ userId: row.userId, type: 'PAYMENT_FAILED', params: { product: row.productCode }, dedupeKey: `invoice:${invoice.id}:failed` });
    }
    return true;
  }

  private async onChargeRefunded(charge: Stripe.Charge): Promise<boolean> {
    const piId = idOf(charge.payment_intent);
    const invoiceId = idOf((charge as unknown as { invoice?: string | { id: string } | null }).invoice);
    const payment =
      (piId ? await prisma.payment.findFirst({ where: { stripePaymentIntentId: piId } }) : null) ??
      (invoiceId ? await prisma.payment.findFirst({ where: { stripeInvoiceId: invoiceId } }) : null);
    if (!payment) return false;

    const minorUnit = await currencyService.minorUnit(payment.currency);
    let refundedMinor = fromStripeAmount(charge.amount_refunded, payment.currency, minorUnit);
    refundedMinor = Math.min(refundedMinor, payment.amountMinor);

    // One immutable compensating ledger entry per Stripe refund (unique reference ⇒ idempotent).
    const refunds = charge.refunds?.data?.length ? charge.refunds.data : await stripe().refunds.list({ charge: charge.id, limit: 100 }).then((r) => r.data);
    for (const r of refunds) {
      if (r.status === 'failed' || r.status === 'canceled') continue;
      await ledgerService.recordRefund(payment, r.id, fromStripeAmount(r.amount, payment.currency, minorUnit));
    }

    const status = refundedMinor >= payment.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    await prisma.payment.update({ where: { id: payment.id }, data: { refundedMinor, status } });
    if (status === 'REFUNDED' && (payment.kind === 'BOOST' || payment.kind === 'FEATURED')) await promotionService.cancelForPayment(payment.id);
    return true;
  }
}

export const stripeWebhookService = new StripeWebhookService();
