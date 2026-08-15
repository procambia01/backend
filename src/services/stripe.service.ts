// src/services/stripe.service.ts
import Stripe from 'stripe';
import { prisma } from '@/config/database';
import { config } from '@/config/env';
import { TransactionStatus } from '@prisma/client';
import logger from '@/utils/logger.util';
import { BadRequestError, NotFoundError } from '@/utils/error.util';

const stripe = new Stripe(config.payment.stripe.secretKey ?? '', {
  apiVersion: '2025-02-24.acacia',
});

// Stripe subscription statuses are lowercase ('active', 'canceled', ...)
// and use the single-L American spelling; our SubscriptionStatus enum
// uses 'CANCELLED'. Map explicitly instead of relying on toUpperCase().
const STRIPE_STATUS_MAP: Record<string, string> = {
  active: 'ACTIVE',
  trialing: 'TRIALING',
  past_due: 'PAST_DUE',
  canceled: 'CANCELLED',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'CANCELLED',
  unpaid: 'UNPAID',
  paused: 'CANCELLED',
};

// ── Plan catalogue ────────────────────────────────────────
export const PLANS = {
  PREMIUM_MONTHLY: {
    id: 'PREMIUM_MONTHLY',
    name: 'Premium',
    tier: 'PREMIUM',
    interval: 'month' as const,
    amount: 999,       // $9.99 USD in cents
    currency: 'usd',
    stripePriceId: process.env.STRIPE_PRICE_PREMIUM_MONTHLY ?? '',
    trialDays: 7,
    features: [
      'Unlimited active offers',
      'Priority in matching algorithm',
      'Advanced rate analytics',
      'Verified trader badge',
      'Priority support',
      'Reduced trust score threshold',
    ],
  },
  PREMIUM_YEARLY: {
    id: 'PREMIUM_YEARLY',
    name: 'Premium (Annual)',
    tier: 'PREMIUM',
    interval: 'year' as const,
    amount: 7999,      // $79.99 — saves $39.89
    currency: 'usd',
    stripePriceId: process.env.STRIPE_PRICE_PREMIUM_YEARLY ?? '',
    trialDays: 0,
    features: [
      'Everything in Premium Monthly',
      'Save 33% vs monthly billing',
      'Early access to beta features',
      'Dedicated account manager',
    ],
  },
  BUSINESS_MONTHLY: {
    id: 'BUSINESS_MONTHLY',
    name: 'Business',
    tier: 'BUSINESS',
    interval: 'month' as const,
    amount: 2999,      // $29.99
    currency: 'usd',
    stripePriceId: process.env.STRIPE_PRICE_BUSINESS_MONTHLY ?? '',
    trialDays: 7,
    features: [
      'Everything in Premium',
      'Multi-currency portfolio dashboard',
      'REST API access',
      'Up to 5 team members',
      'Custom rate alert webhooks',
      'Bulk swap requests',
      'White-glove onboarding',
    ],
  },
  BUSINESS_YEARLY: {
    id: 'BUSINESS_YEARLY',
    name: 'Business (Annual)',
    tier: 'BUSINESS',
    interval: 'year' as const,
    amount: 23999,     // $239.99
    currency: 'usd',
    stripePriceId: process.env.STRIPE_PRICE_BUSINESS_YEARLY ?? '',
    trialDays: 0,
    features: [
      'Everything in Business Monthly',
      'Save 33% vs monthly billing',
      'Dedicated relationship manager',
      'Guaranteed SLA (99.9% uptime)',
    ],
  },
} as const;

export type PlanId = keyof typeof PLANS;

// ─────────────────────────────────────────────────────────
export class StripeService {
  // ── Get or create Stripe customer ─────────────────────
  async getOrCreateCustomer(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, stripeCustomerId: true },
    });
    if (!user) throw new NotFoundError('User not found');
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId },
    });

    await prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customer.id } });
    logger.info(`Stripe customer created for user ${userId}`);
    return customer.id;
  }

  // ── Hosted checkout session ───────────────────────────
  async createCheckoutSession(
    userId: string,
    planId: PlanId,
    successUrl: string,
    cancelUrl: string,
  ) {
    const plan = PLANS[planId];
    const customerId = await this.getOrCreateCustomer(userId);

    const existing = await this.getActiveSubscription(userId);
    if (existing) throw new BadRequestError('You already have an active subscription. Use the billing portal to change plans.');

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&plan=${planId}`,
      cancel_url: cancelUrl,
      subscription_data: {
        metadata: { userId, planId },
        ...(plan.trialDays > 0 && { trial_period_days: plan.trialDays }),
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
      payment_method_collection: 'always',
      metadata: { userId, planId },
      currency: plan.currency,
    });

    // Log pending transaction
    await prisma.transaction.create({
      data: {
        userId,
        type: 'PREMIUM_SUBSCRIPTION',
        amount: plan.amount / 100,
        currency: plan.currency.toUpperCase(),
        description: `${plan.name} subscription`,
        status: TransactionStatus.PENDING,
        paymentGateway: 'stripe',
        gatewayTransactionId: session.id,
      },
    });

    return { url: session.url, sessionId: session.id };
  }

  // ── Stripe customer portal (manage/cancel) ────────────
  async createPortalSession(userId: string, returnUrl: string) {
    const customerId = await this.getOrCreateCustomer(userId);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  // ── Active subscription ───────────────────────────────
  async getActiveSubscription(userId: string) {
    return prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'TRIALING'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Cancel subscription ───────────────────────────────
  async cancelSubscription(userId: string, immediately = false) {
    const sub = await this.getActiveSubscription(userId);
    if (!sub?.stripeSubscriptionId) throw new NotFoundError('No active subscription found');

    if (immediately) {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
    } else {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
    }

    await prisma.subscription.update({
      where: { id: sub.id },
      data: {
        cancelAtPeriodEnd: !immediately,
        status: immediately ? 'CANCELLED' : (sub.status as any),
      },
    });

    if (immediately) {
      await prisma.user.update({
        where: { id: userId },
        data: { isPremium: false, premiumTier: null, premiumExpiry: null },
      });
    }

    return { success: true, cancelAtPeriodEnd: !immediately };
  }

  // ── Webhook handlers ──────────────────────────────────
  async handleSubscriptionActivated(sub: Stripe.Subscription) {
    const { userId, planId } = sub.metadata as { userId: string; planId: PlanId };
    if (!userId || !planId) return;

    const plan = PLANS[planId];
    const periodEnd = new Date((sub as any).current_period_end * 1000);

    await prisma.$transaction([
      prisma.subscription.upsert({
        where: { stripeSubscriptionId: sub.id },
        create: {
          userId,
          stripeSubscriptionId: sub.id,
          stripePriceId: (sub.items.data[0].price as Stripe.Price).id,
          planId,
          status: (STRIPE_STATUS_MAP[sub.status] ?? 'ACTIVE') as any,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          tier: plan.tier,
          interval: plan.interval,
          amount: plan.amount / 100,
          currency: plan.currency.toUpperCase(),
        },
        update: {
          status: (STRIPE_STATUS_MAP[sub.status] ?? 'ACTIVE') as any,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { isPremium: true, premiumTier: plan.tier, premiumExpiry: periodEnd },
      }),
    ]);

    await prisma.transaction.updateMany({
      where: { userId, type: 'PREMIUM_SUBSCRIPTION', status: TransactionStatus.PENDING },
      data: { status: TransactionStatus.COMPLETED, completedAt: new Date() },
    });

    await prisma.notification.create({
      data: {
        userId,
        type: 'SYSTEM_ALERT',
        title: '🎉 Welcome to Premium!',
        message: `Your ${plan.name} subscription is now active. Enjoy all premium features!`,
      },
    });

    logger.info(`Subscription activated — user: ${userId}, plan: ${planId}`);
  }

  async handleSubscriptionDeleted(sub: Stripe.Subscription) {
    const { userId } = sub.metadata as { userId: string };
    if (!userId) return;

    await prisma.$transaction([
      prisma.subscription.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: { status: 'CANCELLED' },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { isPremium: false, premiumTier: null, premiumExpiry: null },
      }),
    ]);

    await prisma.notification.create({
      data: {
        userId,
        type: 'PREMIUM_EXPIRED',
        title: 'Subscription Ended',
        message: 'Your premium subscription has ended. Renew to continue enjoying premium features.',
        link: '/dashboard/premium',
      },
    });

    logger.info(`Subscription cancelled — user: ${userId}`);
  }

  async handleInvoicePaid(invoice: Stripe.Invoice) {
    const customerId = typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer as Stripe.Customer | null)?.id;
    if (!customerId) return;

    const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
    if (!user || invoice.billing_reason !== 'subscription_cycle') return;

    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: 'PREMIUM_SUBSCRIPTION',
        amount: (invoice.amount_paid ?? 0) / 100,
        currency: (invoice.currency ?? 'usd').toUpperCase(),
        description: 'Subscription renewal',
        status: TransactionStatus.COMPLETED,
        paymentGateway: 'stripe',
        gatewayTransactionId: invoice.id ?? '',
        completedAt: new Date(),
      },
    });

    logger.info(`Subscription renewed — user: ${user.id}`);
  }

  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    const secret = config.payment.stripe.webhookSecret;
    if (!secret) throw new Error('Stripe webhook secret not configured');
    return stripe.webhooks.constructEvent(payload, signature, secret);
  }

  getPlans() {
    return Object.values(PLANS);
  }
}
