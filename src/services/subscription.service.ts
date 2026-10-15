import type { PlanTier, Subscription as SubRow, SubscriptionStatus } from '@prisma/client';
import type Stripe from 'stripe';
import { prisma } from '@/config/database';
import { fromStripeAmount } from '@/lib/money';
import logger from '@/utils/logger.util';
import { currencyService } from './currency.service';
import { notificationService } from './notification.service';
import { stripe } from './stripe.client';
import { apiKeyService } from './apikey.service';

const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: 'ACTIVE',
  trialing: 'TRIALING',
  past_due: 'PAST_DUE',
  canceled: 'CANCELLED',
  incomplete: 'INCOMPLETE',
  incomplete_expired: 'CANCELLED',
  unpaid: 'UNPAID',
  paused: 'CANCELLED',
};

const TIER_RANK: Record<PlanTier, number> = { FREE: 0, PREMIUM: 1, BUSINESS: 2 };
const ts = (n?: number | null) => (n ? new Date(n * 1000) : null);

export class SubscriptionService {
  async resolveUserId(sub: Stripe.Subscription): Promise<string | null> {
    if (sub.metadata?.userId) return sub.metadata.userId;
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const bc = await prisma.billingCustomer.findFirst({ where: { stripeCustomerId: customerId } });
    return bc?.userId ?? null;
  }

  /** Upserts our row from Stripe's view of the subscription, then recomputes entitlements. */
  async sync(sub: Stripe.Subscription): Promise<SubRow | null> {
    const userId = await this.resolveUserId(sub);
    if (!userId) {
      logger.warn('subscription for unknown customer', { subscription: sub.id });
      return null;
    }
    const productCode = sub.metadata?.productCode;
    const product = productCode ? await prisma.serviceProduct.findUnique({ where: { code: productCode } }) : null;
    if (!product) {
      logger.warn('subscription with unknown product', { subscription: sub.id, productCode });
      return null;
    }
    const item = sub.items.data[0];
    const currency = (item?.price.currency ?? product.currency).toUpperCase();
    const minorUnit = await currencyService.minorUnit(currency).catch(() => 2);
    const amountMinor = item?.price.unit_amount != null ? fromStripeAmount(item.price.unit_amount, currency, minorUnit) : product.amountMinor;
    const data = {
      userId,
      stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      productCode: product.code,
      kind: product.kind,
      tier: product.planTier ?? (product.kind === 'BUSINESS_PLAN' ? ('BUSINESS' as const) : ('PREMIUM' as const)),
      status: STATUS_MAP[sub.status] ?? 'INCOMPLETE',
      interval: product.interval,
      amountMinor,
      currency,
      currentPeriodStart: ts(sub.current_period_start),
      currentPeriodEnd: ts(sub.current_period_end),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: ts(sub.canceled_at),
      trialEnd: ts(sub.trial_end),
      latestInvoiceId: typeof sub.latest_invoice === 'string' ? sub.latest_invoice : (sub.latest_invoice?.id ?? null),
    };
    const row = await prisma.subscription.upsert({ where: { stripeSubscriptionId: sub.id }, create: { stripeSubscriptionId: sub.id, ...data }, update: data });
    await this.recomputeEntitlements(userId);
    if (product.kind === 'API_PLAN') await apiKeyService.syncPlanLimits(userId);
    return row;
  }

  /** Always re-read from Stripe so out-of-order webhook delivery cannot regress state. */
  async syncById(stripeSubscriptionId: string, fallback?: Stripe.Subscription) {
    let fresh: Stripe.Subscription | null = null;
    try {
      fresh = await stripe().subscriptions.retrieve(stripeSubscriptionId);
    } catch {
      fresh = fallback ?? null;
    }
    return fresh ? this.sync(fresh) : null;
  }

  /**
   * Plan entitlement = best tier among subscriptions that are currently paid
   * for. `planExpiresAt` is the period end, so access also lapses on its own
   * when no renewal webhook arrives (entitlement checks compare with "now").
   */
  async recomputeEntitlements(userId: string): Promise<void> {
    const now = new Date();
    const subs = await prisma.subscription.findMany({ where: { userId, kind: { in: ['PREMIUM_PLAN', 'BUSINESS_PLAN'] } } });
    let best: { tier: PlanTier; until: Date | null } = { tier: 'FREE', until: null };
    for (const s of subs) {
      const live = s.status === 'ACTIVE' || s.status === 'TRIALING' || (s.status === 'PAST_DUE' && !!s.currentPeriodEnd && s.currentPeriodEnd > now);
      if (!live || !s.currentPeriodEnd || s.currentPeriodEnd <= now) continue;
      if (TIER_RANK[s.tier] > TIER_RANK[best.tier] || (s.tier === best.tier && best.until && s.currentPeriodEnd > best.until)) {
        best = { tier: s.tier, until: s.currentPeriodEnd };
      }
    }
    const before = await prisma.user.findUnique({ where: { id: userId }, select: { planTier: true } });
    await prisma.user.update({ where: { id: userId }, data: { planTier: best.tier, planExpiresAt: best.until } });
    if (before && before.planTier !== 'FREE' && best.tier === 'FREE') {
      await notificationService.notify({ userId, type: 'PLAN_EXPIRED', dedupeKey: `plan-expired:${userId}:${now.toISOString().slice(0, 10)}` });
    }
  }

  /** Job: backstop for missed webhooks — downgrade anyone whose paid period has elapsed. */
  async expireLapsed(now = new Date()): Promise<number> {
    const users = await prisma.user.findMany({ where: { planTier: { not: 'FREE' }, planExpiresAt: { lte: now } }, select: { id: true }, take: 500 });
    for (const u of users) await this.recomputeEntitlements(u.id).catch((e) => logger.warn('expireLapsed failed', { userId: u.id, m: (e as Error).message }));
    return users.length;
  }

  /** Job: warn users 3 days before a non-renewing plan ends. */
  async notifyExpiring(now = new Date()): Promise<number> {
    const soon = new Date(now.getTime() + 3 * 86_400_000);
    const subs = await prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'TRIALING'] }, cancelAtPeriodEnd: true, currentPeriodEnd: { gt: now, lte: soon } }, take: 500 });
    for (const s of subs) {
      await notificationService.notify({
        userId: s.userId, type: 'PLAN_EXPIRING', params: { plan: s.tier, date: s.currentPeriodEnd!.toISOString().slice(0, 10) }, dedupeKey: `plan-expiring:${s.id}:${s.currentPeriodEnd!.toISOString().slice(0, 10)}`,
      });
    }
    return subs.length;
  }
}

export const subscriptionService = new SubscriptionService();
