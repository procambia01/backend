import type { PlanTier } from '@prisma/client';

export interface PlanHolder {
  planTier: PlanTier;
  planExpiresAt: Date | null;
}

/** The plan actually in force right now. An expired plan is FREE even if no job has downgraded it yet. */
export function effectivePlan(user: PlanHolder, now = new Date()): PlanTier {
  if (user.planTier === 'FREE') return 'FREE';
  if (user.planExpiresAt && user.planExpiresAt.getTime() <= now.getTime()) return 'FREE';
  return user.planTier;
}

export const isPremium = (user: PlanHolder, now = new Date()): boolean => effectivePlan(user, now) !== 'FREE';
export const isBusiness = (user: PlanHolder, now = new Date()): boolean => effectivePlan(user, now) === 'BUSINESS';
