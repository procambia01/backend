import type { LimitPolicy, User } from '@prisma/client';
import { prisma } from '@/config/database';
import { effectivePlan } from '@/lib/entitlements';
import { convertMinor } from '@/lib/money';
import { LimitExceededError, VerificationRequiredError } from '@/utils/error.util';
import { currencyService } from './currency.service';
import { exchangeRateService } from './exchangeRate.service';

type PolicyShape = Omit<LimitPolicy, 'id' | 'updatedBy' | 'updatedAt'>;

/** Seed values + the safety net used only if an admin deleted every policy. Live values come from the database. */
export const DEFAULT_LIMIT_POLICIES: PolicyShape[] = [
  { key: 'UNVERIFIED', name: 'Unverified', limitCurrency: 'EUR', maxSwapMinor: 20_000n, dailyMinor: 20_000n, weeklyMinor: 50_000n, monthlyMinor: 100_000n, maxActiveOffers: 2, maxActiveSwaps: 2, maxRateAlerts: 1, apiCallsPerMonth: 0, maxBoostPurchasesMonth: 2, maxTeamMembers: 0, advancedSearch: false, priorityMatching: false, advancedAnalytics: false, premiumBadge: false, prioritySupport: false, apiAccess: false },
  { key: 'VERIFIED', name: 'Verified', limitCurrency: 'EUR', maxSwapMinor: 200_000n, dailyMinor: 300_000n, weeklyMinor: 800_000n, monthlyMinor: 2_000_000n, maxActiveOffers: 5, maxActiveSwaps: 5, maxRateAlerts: 3, apiCallsPerMonth: 0, maxBoostPurchasesMonth: 10, maxTeamMembers: 0, advancedSearch: false, priorityMatching: false, advancedAnalytics: false, premiumBadge: false, prioritySupport: false, apiAccess: false },
  { key: 'ENHANCED', name: 'Enhanced verification', limitCurrency: 'EUR', maxSwapMinor: 1_000_000n, dailyMinor: 1_500_000n, weeklyMinor: 4_000_000n, monthlyMinor: 10_000_000n, maxActiveOffers: 10, maxActiveSwaps: 10, maxRateAlerts: 5, apiCallsPerMonth: 0, maxBoostPurchasesMonth: 20, maxTeamMembers: 0, advancedSearch: false, priorityMatching: false, advancedAnalytics: false, premiumBadge: false, prioritySupport: false, apiAccess: false },
  { key: 'PREMIUM', name: 'Premium', limitCurrency: 'EUR', maxSwapMinor: 500_000n, dailyMinor: 800_000n, weeklyMinor: 2_000_000n, monthlyMinor: 5_000_000n, maxActiveOffers: 1000, maxActiveSwaps: 15, maxRateAlerts: 25, apiCallsPerMonth: 0, maxBoostPurchasesMonth: 50, maxTeamMembers: 0, advancedSearch: true, priorityMatching: true, advancedAnalytics: true, premiumBadge: true, prioritySupport: true, apiAccess: false },
  { key: 'BUSINESS', name: 'Business', limitCurrency: 'EUR', maxSwapMinor: 2_000_000n, dailyMinor: 4_000_000n, weeklyMinor: 12_000_000n, monthlyMinor: 30_000_000n, maxActiveOffers: 1000, maxActiveSwaps: 50, maxRateAlerts: 100, apiCallsPerMonth: 100_000, maxBoostPurchasesMonth: 200, maxTeamMembers: 10, advancedSearch: true, priorityMatching: true, advancedAnalytics: true, premiumBadge: true, prioritySupport: true, apiAccess: true },
];

const NUMERIC = ['maxSwapMinor', 'dailyMinor', 'weeklyMinor', 'monthlyMinor'] as const;
const INTS = ['maxActiveOffers', 'maxActiveSwaps', 'maxRateAlerts', 'apiCallsPerMonth', 'maxBoostPurchasesMonth', 'maxTeamMembers'] as const;
const FLAGS = ['advancedSearch', 'priorityMatching', 'advancedAnalytics', 'premiumBadge', 'prioritySupport', 'apiAccess'] as const;

export type EffectiveLimits = PolicyShape & { sources: string[] };

export function mergePolicies(policies: PolicyShape[]): EffectiveLimits {
  const base = { ...policies[0] } as PolicyShape;
  for (const p of policies.slice(1)) {
    for (const k of NUMERIC) if (p[k] > base[k]) base[k] = p[k];
    for (const k of INTS) if (p[k] > base[k]) base[k] = p[k];
    for (const k of FLAGS) base[k] = base[k] || p[k];
  }
  return { ...base, key: policies.map((p) => p.key).join('+'), sources: policies.map((p) => p.key) };
}

/** Which policy keys apply to a user right now. */
export function applicableKeys(user: Pick<User, 'idVerified' | 'verificationStatus' | 'verificationTier' | 'planTier' | 'planExpiresAt'>, now = new Date()): string[] {
  const keys: string[] = [];
  const verified = user.idVerified && user.verificationStatus === 'VERIFIED';
  keys.push(!verified ? 'UNVERIFIED' : user.verificationTier === 'ENHANCED' ? 'ENHANCED' : 'VERIFIED');
  const plan = effectivePlan(user, now);
  if (plan === 'PREMIUM' || plan === 'BUSINESS') keys.push(plan);
  return keys;
}

const ACTIVE_SWAP_STATES = ['PENDING', 'AGREED', 'IN_PROGRESS', 'CONFIRMING', 'DISPUTED'] as const;

export class LimitService {
  async forUser(userId: string): Promise<EffectiveLimits> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.forUserRecord(user);
  }

  async forUserRecord(user: User): Promise<EffectiveLimits> {
    const keys = applicableKeys(user);
    const rows = await prisma.limitPolicy.findMany({ where: { key: { in: keys } } });
    const found = keys.map((k) => rows.find((r) => r.key === k) ?? DEFAULT_LIMIT_POLICIES.find((d) => d.key === k)!).filter(Boolean);
    return mergePolicies(found as PolicyShape[]);
  }

  /** Converts an amount to the policy currency's minor units via reference rates. */
  private async toLimitMinor(amountMinor: bigint, currency: string, limitCurrency: string): Promise<bigint> {
    if (currency === limitCurrency) return amountMinor;
    const [from, to] = await Promise.all([currencyService.minorUnit(currency), currencyService.minorUnit(limitCurrency)]);
    const { rateScaled } = await exchangeRateService.getRateScaled(currency, limitCurrency);
    return convertMinor(amountMinor, from, to, rateScaled);
  }

  private async usageSince(userId: string, since: Date, limitCurrency: string): Promise<bigint> {
    const swaps = await prisma.swap.findMany({
      where: { OR: [{ initiatorId: userId }, { receiverId: userId }], createdAt: { gte: since }, status: { not: 'CANCELLED' } },
      select: { haveCurrency: true, requestedHaveMinor: true, agreedHaveMinor: true },
      take: 1000,
    });
    let total = 0n;
    for (const s of swaps) total += await this.toLimitMinor(s.agreedHaveMinor ?? s.requestedHaveMinor, s.haveCurrency, limitCurrency);
    return total;
  }

  /** Enforced server-side when a swap is requested and again when it is accepted. */
  async assertSwapAllowed(userId: string, currency: string, amountMinor: bigint): Promise<void> {
    const limits = await this.forUser(userId);
    const amount = await this.toLimitMinor(amountMinor, currency, limits.limitCurrency);
    if (amount > limits.maxSwapMinor) {
      throw this.exceeded('maxSwap', limits, 'This amount exceeds your per-swap limit. Verify your identity to raise it.');
    }
    const now = Date.now();
    const windows: [string, number, bigint][] = [
      ['daily', 86_400_000, limits.dailyMinor],
      ['weekly', 7 * 86_400_000, limits.weeklyMinor],
      ['monthly', 30 * 86_400_000, limits.monthlyMinor],
    ];
    for (const [name, ms, cap] of windows) {
      const used = await this.usageSince(userId, new Date(now - ms), limits.limitCurrency);
      if (used + amount > cap) throw this.exceeded(name, limits, `This would exceed your ${name} limit.`);
    }
  }

  private exceeded(limit: string, l: EffectiveLimits, message: string) {
    const unverified = l.sources.includes('UNVERIFIED');
    return unverified && limit !== 'daily' ? new VerificationRequiredError(message) : new LimitExceededError(message, { limit, tier: l.sources });
  }

  async assertCanCreateOffer(userId: string): Promise<void> {
    const limits = await this.forUser(userId);
    const n = await prisma.swapOffer.count({ where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } } });
    if (n >= limits.maxActiveOffers) throw new LimitExceededError('You have reached your active offer limit', { limit: 'maxActiveOffers', max: limits.maxActiveOffers });
  }

  async assertCanStartSwap(userId: string): Promise<void> {
    const limits = await this.forUser(userId);
    const n = await prisma.swap.count({ where: { OR: [{ initiatorId: userId }, { receiverId: userId }], status: { in: [...ACTIVE_SWAP_STATES] } } });
    if (n >= limits.maxActiveSwaps) throw new LimitExceededError('You have reached your active swap limit', { limit: 'maxActiveSwaps', max: limits.maxActiveSwaps });
  }

  async assertCanCreateAlert(userId: string): Promise<void> {
    const limits = await this.forUser(userId);
    const n = await prisma.rateAlert.count({ where: { userId, isActive: true } });
    if (n >= limits.maxRateAlerts) throw new LimitExceededError('You have reached your rate alert limit', { limit: 'maxRateAlerts', max: limits.maxRateAlerts });
  }

  async assertBoostPurchase(userId: string): Promise<void> {
    const limits = await this.forUser(userId);
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const n = await prisma.payment.count({ where: { userId, kind: 'BOOST', status: { in: ['SUCCEEDED', 'PROCESSING', 'PARTIALLY_REFUNDED'] }, createdAt: { gte: start } } });
    if (n >= limits.maxBoostPurchasesMonth) throw new LimitExceededError('Monthly Boost purchase limit reached', { limit: 'maxBoostPurchasesMonth', max: limits.maxBoostPurchasesMonth });
  }

  async assertFeature(userId: string, feature: (typeof FLAGS)[number]): Promise<void> {
    const limits = await this.forUser(userId);
    if (!limits[feature]) {
      const { PlanRequiredError } = await import('@/utils/error.util');
      throw new PlanRequiredError(`Your plan does not include ${feature}`);
    }
  }

  // ───────────── admin ─────────────

  async list() {
    return prisma.limitPolicy.findMany({ orderBy: { key: 'asc' } });
  }
}

export const limitService = new LimitService();
