import type { Payment, ServiceProduct } from '@prisma/client';
import type { PaymentDto, ServiceProductDto, SubscriptionDto } from '@/contracts';
import { toPaymentDto, toServiceProductDto, toSubscriptionDto } from '@/presenters/billing.presenter';
import type Stripe from 'stripe';
import { prisma } from '@/config/database';
import { config } from '@/config/env';
import { toStripeAmount } from '@/lib/money';
import { BadRequestError, ConflictError, NotFoundError, ServiceUnavailableError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { currencyService } from './currency.service';
import { limitService } from './limit.service';
import { stripe } from './stripe.client';
import { auditService } from './audit.service';

const CHECKOUT_BUCKET_MS = 30 * 60_000;
const PLAN_KINDS = new Set(['PREMIUM_PLAN', 'BUSINESS_PLAN', 'API_PLAN']);

export interface CheckoutInput {
  userId: string;
  email: string;
  name?: string;
  productCode: string;
  /** offerId (BOOST/FEATURED), verification caseId (VERIFICATION), campaignId (ADVERTISING). */
  targetId?: string;
}

export class BillingService {
  async listProducts(kind?: ServiceProduct['kind']): Promise<ServiceProductDto[]> {
    const rows = await prisma.serviceProduct.findMany({ where: { isActive: true, ...(kind ? { kind } : {}) }, orderBy: [{ sortOrder: 'asc' }, { amountMinor: 'asc' }] });
    const units = await currencyService.unitMap();
    return rows.map((p) => toServiceProductDto(p, units));
  }

  /** Validates that the purchase makes sense for this user/target BEFORE any Stripe object exists. */
  private async validateTarget(product: ServiceProduct, input: CheckoutInput): Promise<{ targetType: string | null; targetId: string | null }> {
    switch (product.kind) {
      case 'PREMIUM_PLAN':
      case 'BUSINESS_PLAN':
      case 'API_PLAN': {
        if (product.interval === 'ONE_TIME') throw new ConflictError('Plan products must be recurring');
        const existing = await prisma.subscription.findFirst({ where: { userId: input.userId, kind: product.kind, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } } });
        if (existing) throw new ConflictError('You already have an active subscription. Manage it from the billing portal.');
        return { targetType: null, targetId: null };
      }
      case 'BOOST':
      case 'FEATURED': {
        if (!input.targetId) throw new BadRequestError('offerId is required');
        const offer = await prisma.swapOffer.findFirst({ where: { id: input.targetId, userId: input.userId } });
        if (!offer) throw new NotFoundError('Offer not found');
        if (offer.status !== 'ACTIVE' || offer.availableUntil <= new Date()) throw new BadRequestError('Only active offers can be promoted');
        if (product.kind === 'BOOST') await limitService.assertBoostPurchase(input.userId);
        return { targetType: 'OFFER', targetId: offer.id };
      }
      case 'VERIFICATION': {
        if (!input.targetId) throw new BadRequestError('caseId is required');
        const c = await prisma.verificationCase.findFirst({ where: { id: input.targetId, userId: input.userId } });
        if (!c) throw new NotFoundError('Verification case not found');
        if (c.tier !== 'ENHANCED') throw new BadRequestError('Only enhanced verification has a fee');
        if (c.paymentId) throw new ConflictError('This verification has already been paid');
        if (!['SUBMITTED', 'UNDER_REVIEW'].includes(c.status)) throw new BadRequestError('This verification case is closed');
        return { targetType: 'VERIFICATION_CASE', targetId: c.id };
      }
      case 'ADVERTISING': {
        if (!input.targetId) throw new BadRequestError('campaignId is required');
        const camp = await prisma.adCampaign.findFirst({ where: { id: input.targetId, advertiserId: input.userId } });
        if (!camp) throw new NotFoundError('Campaign not found');
        if (!['DRAFT', 'PENDING_PAYMENT'].includes(camp.status)) throw new ConflictError('This campaign cannot be purchased in its current state');
        return { targetType: 'AD_CAMPAIGN', targetId: camp.id };
      }
      default:
        throw new BadRequestError('Unsupported product');
    }
  }

  async ensureCustomer(userId: string, email: string, name?: string): Promise<string> {
    const existing = await prisma.billingCustomer.findUnique({ where: { userId } });
    if (existing) return existing.stripeCustomerId;
    const customer = await stripe().customers.create({ email, name, metadata: { userId } }, { idempotencyKey: `customer:${userId}` });
    try {
      await prisma.billingCustomer.create({ data: { userId, stripeCustomerId: customer.id } });
    } catch {
      const again = await prisma.billingCustomer.findUnique({ where: { userId } });
      if (again) return again.stripeCustomerId;
      throw new ServiceUnavailableError('Could not create billing profile');
    }
    return customer.id;
  }

  /** Prices ALWAYS come from the database product, never from the request. */
  async createCheckout(input: CheckoutInput): Promise<{ url: string; paymentId: string }> {
    const product = await prisma.serviceProduct.findUnique({ where: { code: input.productCode } });
    if (!product || !product.isActive) throw new NotFoundError('Product not available');
    const currency = await currencyService.get(product.currency);
    const { targetType, targetId } = await this.validateTarget(product, input);

    const bucket = Math.floor(Date.now() / CHECKOUT_BUCKET_MS);
    const idempotencyKey = `checkout:${input.userId}:${product.code}:${targetId ?? '-'}:${bucket}`;

    let payment = await prisma.payment.findUnique({ where: { idempotencyKey } });
    if (payment?.stripeCheckoutSessionId && payment.status === 'REQUIRES_PAYMENT') {
      const s = await stripe().checkout.sessions.retrieve(payment.stripeCheckoutSessionId);
      if (s.status === 'open' && s.url) return { url: s.url, paymentId: payment.id };
    }
    if (payment && payment.status !== 'REQUIRES_PAYMENT') {
      throw new ConflictError('This purchase was already processed');
    }

    const customerId = await this.ensureCustomer(input.userId, input.email, input.name);
    if (!payment) {
      try {
        payment = await prisma.payment.create({
          data: { userId: input.userId, productId: product.id, productCode: product.code, kind: product.kind, amountMinor: product.amountMinor, currency: product.currency.toUpperCase(), targetType, targetId, idempotencyKey },
        });
      } catch {
        payment = await prisma.payment.findUnique({ where: { idempotencyKey } });
        if (!payment) throw new ServiceUnavailableError('Could not start checkout');
      }
    }

    const recurring = PLAN_KINDS.has(product.kind) && product.interval !== 'ONE_TIME';
    const metadata = { paymentId: payment.id, userId: input.userId, productCode: product.code, kind: product.kind, targetType: targetType ?? '', targetId: targetId ?? '' };
    const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
      currency: product.currency.toLowerCase(),
      unit_amount: toStripeAmount(product.amountMinor, product.currency, currency.minorUnit),
      product_data: { name: `CashMouver — ${product.name}`, description: product.description ?? undefined },
      ...(recurring ? { recurring: { interval: product.interval === 'YEAR' ? 'year' : 'month' } } : {}),
    };

    const params: Stripe.Checkout.SessionCreateParams = {
      mode: recurring ? 'subscription' : 'payment',
      customer: customerId,
      client_reference_id: payment.id,
      line_items: [{ quantity: 1, price_data: priceData }],
      metadata,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      success_url: `${config.appUrl}/dashboard/billing?payment=${payment.id}&status=return`,
      cancel_url: `${config.appUrl}/dashboard/billing?payment=${payment.id}&status=cancelled`,
      ...(recurring
        ? { subscription_data: { metadata, ...(product.trialDays > 0 ? { trial_period_days: product.trialDays } : {}) } }
        : { payment_intent_data: { metadata, description: product.name } }),
    };

    const session = await stripe().checkout.sessions.create(params, { idempotencyKey: `session:${payment.id}` });
    await prisma.payment.update({ where: { id: payment.id }, data: { stripeCheckoutSessionId: session.id } });
    if (product.kind === 'ADVERTISING' && targetId) {
      await prisma.adCampaign.updateMany({ where: { id: targetId, status: 'DRAFT' }, data: { status: 'PENDING_PAYMENT', productCode: product.code } });
    }
    if (!session.url) throw new ServiceUnavailableError('Stripe did not return a checkout URL');
    return { url: session.url, paymentId: payment.id };
  }

  /**
   * What the UI shows after returning from Stripe. The *server-side* status is
   * authoritative (set only by verified webhooks); the redirect itself proves nothing.
   */
  async getPayment(userId: string, paymentId: string): Promise<PaymentDto> {
    const p = await prisma.payment.findFirst({ where: { id: paymentId, userId } });
    if (!p) throw new NotFoundError('Payment not found');
    return toPaymentDto(p, await currencyService.unitMap());
  }

  async listPayments(userId: string, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      prisma.payment.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      prisma.payment.count({ where: { userId } }),
    ]);
    const units = await currencyService.unitMap();
    return { items: rows.map((p) => toPaymentDto(p, units)), total };
  }

  async portalUrl(userId: string): Promise<string> {
    const c = await prisma.billingCustomer.findUnique({ where: { userId } });
    if (!c) throw new NotFoundError('No billing profile yet');
    const s = await stripe().billingPortal.sessions.create({ customer: c.stripeCustomerId, return_url: `${config.appUrl}/dashboard/billing` });
    return s.url;
  }

  async mySubscriptions(userId: string): Promise<SubscriptionDto[]> {
    const subs = await prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const units = await currencyService.unitMap();
    return subs.map((s) => toSubscriptionDto(s, units));
  }

  /** Cancellation takes effect at period end; the webhook then updates our row. */
  async setCancelAtPeriodEnd(userId: string, subscriptionId: string, cancel: boolean) {
    const sub = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId } });
    if (!sub) throw new NotFoundError('Subscription not found');
    await stripe().subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: cancel });
    await prisma.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: cancel } });
    return { cancelAtPeriodEnd: cancel };
  }

  /**
   * Admin refund of a CashMouver SERVICE payment only. The exchanged currency
   * between users is never refunded by CashMouver. The ledger and payment row
   * are updated by the verified `charge.refunded` webhook, not here.
   */
  async adminRefund(adminId: string, paymentId: string, amountMinor: number | undefined, reason: string) {
    const p = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundError('Payment not found');
    if (!p.stripePaymentIntentId || !['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(p.status)) throw new BadRequestError('Payment cannot be refunded');
    const remaining = p.amountMinor - p.refundedMinor;
    const amount = amountMinor ?? remaining;
    if (!Number.isInteger(amount) || amount <= 0 || amount > remaining) throw new BadRequestError('Invalid refund amount');
    const minorUnit = await currencyService.minorUnit(p.currency);
    const refund = await stripe().refunds.create(
      { payment_intent: p.stripePaymentIntentId, amount: toStripeAmount(amount, p.currency, minorUnit), reason: 'requested_by_customer', metadata: { paymentId: p.id, adminId } },
      { idempotencyKey: `refund:${p.id}:${p.refundedMinor}:${amount}` }
    );
    await auditService.record({ actorId: adminId, action: 'payment.refund_requested', targetType: 'Payment', targetId: p.id, after: { amountMinor: amount, stripeRefundId: refund.id }, reason });
    logger.info('refund requested', { paymentId: p.id, amount });
    return { refundId: refund.id, status: refund.status };
  }
}

export const billingService = new BillingService();
