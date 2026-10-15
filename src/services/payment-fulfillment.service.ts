import type { Payment } from '@prisma/client';
import { prisma } from '@/config/database';
import { toStripeAmount } from '@/lib/money';
import { PaymentMismatchError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { adService } from './ad.service';
import { currencyService } from './currency.service';
import { ledgerService } from './ledger.service';
import { notificationService } from './notification.service';
import { promotionService } from './promotion.service';
import { referralService } from './referral.service';
import { riskService } from './risk.service';
import { verificationService } from './verification.service';

/** Failure that retrying can never fix (forged/mismatched data). The webhook is acknowledged, but flagged. */
export class NonRetryableWebhookError extends Error {
  constructor(message: string, public readonly code = 'NON_RETRYABLE') {
    super(message);
  }
}

export interface PaidRefs {
  /** Amount Stripe says was paid, in Stripe's minor units. */
  amountPaid: number;
  currency: string;
  paymentIntentId?: string | null;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  checkoutSessionId?: string | null;
  customerUserId?: string | null;
}

export class PaymentFulfillmentService {
  /** Throws NonRetryableWebhookError (and fails the Payment) when Stripe's numbers do not match ours. */
  private async verify(payment: Payment, refs: PaidRefs, trialOrFree: boolean): Promise<void> {
    const minorUnit = await currencyService.minorUnit(payment.currency);
    const expected = toStripeAmount(payment.amountMinor, payment.currency, minorUnit);
    const problems: string[] = [];
    if (refs.currency.toUpperCase() !== payment.currency.toUpperCase()) problems.push('currency');
    if (!trialOrFree && refs.amountPaid !== expected) problems.push('amount');
    if (refs.customerUserId && refs.customerUserId !== payment.userId) problems.push('user');
    if (refs.checkoutSessionId && payment.stripeCheckoutSessionId && refs.checkoutSessionId !== payment.stripeCheckoutSessionId) problems.push('session');
    if (!problems.length) return;

    logger.error('payment verification failed', { paymentId: payment.id, problems });
    await riskService.onPaymentMismatch(payment.userId, payment.id, problems.join(',')).catch(() => undefined);
    await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: ['REQUIRES_PAYMENT', 'PROCESSING'] } },
      data: { status: 'FAILED', failedAt: new Date(), failureReason: `MISMATCH:${problems.join(',')}` },
    });
    throw new NonRetryableWebhookError(new PaymentMismatchError(problems.join(',')).message, 'PAYMENT_MISMATCH');
  }

  /**
   * Marks a payment paid and applies the purchased service exactly once.
   * Safe to call repeatedly (duplicate / replayed / retried events): the
   * status flip is a guarded update and every effect is idempotent.
   */
  async fulfill(paymentId: string, refs: PaidRefs): Promise<{ firstTime: boolean }> {
    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NonRetryableWebhookError('Unknown payment', 'UNKNOWN_PAYMENT');
    if (['REFUNDED'].includes(payment.status)) return { firstTime: false };

    const free = refs.amountPaid === 0 && refs.subscriptionId != null; // trial invoice
    await this.verify(payment, refs, free);

    const now = new Date();
    const claimed = await prisma.payment.updateMany({
      where: { id: payment.id, status: { in: ['REQUIRES_PAYMENT', 'PROCESSING', 'FAILED'] } },
      data: {
        status: 'SUCCEEDED',
        paidAt: now,
        failedAt: null,
        failureReason: null,
        ...(refs.paymentIntentId ? { stripePaymentIntentId: refs.paymentIntentId } : {}),
        ...(refs.invoiceId ? { stripeInvoiceId: refs.invoiceId } : {}),
        ...(refs.subscriptionId ? { stripeSubscriptionId: refs.subscriptionId } : {}),
      },
    });
    const current = claimed.count === 1 ? { ...payment, status: 'SUCCEEDED' as const } : await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (current.status !== 'SUCCEEDED') return { firstTime: false };
    if (current.fulfilledAt) return { firstTime: false };

    await this.applyEffects(current, free);
    await prisma.payment.update({ where: { id: payment.id }, data: { fulfilledAt: new Date() } });
    return { firstTime: claimed.count === 1 };
  }

  private async applyEffects(payment: Payment, free: boolean): Promise<void> {
    if (!free) await ledgerService.recordSale(payment);

    switch (payment.kind) {
      case 'BOOST':
        await promotionService.grantBoost(payment);
        break;
      case 'FEATURED':
        await promotionService.grantFeatured(payment);
        break;
      case 'VERIFICATION':
        if (payment.targetId) await verificationService.onFeePaid(payment.targetId, payment.id);
        break;
      case 'ADVERTISING':
        if (payment.targetId) await adService.onPaid(payment.targetId, payment.id);
        break;
      default:
        break; // plans: entitlements come from the subscription sync
    }

    await notificationService.notify({
      userId: payment.userId,
      type: 'PAYMENT_SUCCESS',
      entityId: payment.id,
      params: { product: payment.productCode },
      dedupeKey: `payment:${payment.id}:success`,
    });
    if (payment.kind === 'PREMIUM_PLAN' || payment.kind === 'BUSINESS_PLAN') {
      await referralService.onQualifyingEvent(payment.userId, 'PAID_PLAN_PURCHASE').catch(() => undefined);
    }
  }

  async fail(paymentId: string, reason: string): Promise<void> {
    const p = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) return;
    const r = await prisma.payment.updateMany({
      where: { id: paymentId, status: { in: ['REQUIRES_PAYMENT', 'PROCESSING'] } },
      data: { status: 'FAILED', failedAt: new Date(), failureReason: reason.slice(0, 200) },
    });
    if (r.count === 1) {
      await notificationService.notify({ userId: p.userId, type: 'PAYMENT_FAILED', entityId: p.id, params: { product: p.productCode }, dedupeKey: `payment:${p.id}:failed:${Date.now() - (Date.now() % 600000)}` });
    }
  }
}

export const paymentFulfillment = new PaymentFulfillmentService();
