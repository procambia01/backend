import type { QualifyingAction } from '@prisma/client';
import type { ReferralItemDto, ReferralSummaryDto } from '@/contracts';
import { prisma } from '@/config/database';
import { config } from '@/config/env';
import { fromMinor } from '@/lib/money';
import { currencyService } from './currency.service';
import { HelpersUtil } from '@/utils/helpers.util';
import { BadRequestError, NotFoundError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { auditService } from './audit.service';

/** Risk score at/above which a referral is held for manual review instead of auto-qualifying. */
const REVIEW_THRESHOLD = 60;

export class ReferralService {
  async ensureCode(userId: string) {
    const existing = await prisma.referralCode.findUnique({ where: { userId } });
    if (existing) return existing;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await prisma.referralCode.create({ data: { userId, code: HelpersUtil.generateReferralCode(8) } });
      } catch (error) {
        const again = await prisma.referralCode.findUnique({ where: { userId } });
        if (again) return again; // concurrent creation
        if (attempt === 4) throw error;
      }
    }
    throw new Error('unreachable');
  }

  /** Records the sign-up attribution. Does NOT reward anything — sign-up alone is never a qualifying action. */
  async attachOnSignup(p: { referredId: string; code: string; deviceHash: string | null; ipHash: string | null }) {
    const refCode = await prisma.referralCode.findUnique({ where: { code: p.code.trim().toUpperCase() } });
    if (!refCode || !refCode.isActive) throw new BadRequestError('Invalid referral code');
    if (refCode.userId === p.referredId) throw new BadRequestError('You cannot refer yourself');

    const flags: string[] = [];
    let risk = 0;

    // Same device as the referrer → likely a duplicate account.
    if (p.deviceHash) {
      const sameDevice = await prisma.loginDevice.count({ where: { userId: refCode.userId, deviceHash: p.deviceHash } });
      if (sameDevice > 0) {
        flags.push('SAME_DEVICE_AS_REFERRER');
        risk += 70;
      }
      const reusedDevice = await prisma.referral.count({ where: { signupDeviceHash: p.deviceHash } });
      if (reusedDevice > 0) {
        flags.push('DEVICE_REUSED_ACROSS_REFERRALS');
        risk += 40;
      }
    }
    if (p.ipHash) {
      const since = new Date(Date.now() - 24 * 3600_000);
      const sameIp = await prisma.referral.count({ where: { referrerId: refCode.userId, signupIpHash: p.ipHash, createdAt: { gte: since } } });
      if (sameIp >= 2) {
        flags.push('SAME_IP_BURST');
        risk += 30 + 10 * Math.min(sameIp, 4);
      }
    }
    const burst = await prisma.referral.count({ where: { referrerId: refCode.userId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (burst >= 5) {
      flags.push('SIGNUP_VELOCITY');
      risk += 40;
    }

    return prisma.referral.create({
      data: {
        referrerId: refCode.userId,
        referredId: p.referredId,
        code: refCode.code,
        status: risk >= REVIEW_THRESHOLD ? 'UNDER_REVIEW' : 'PENDING',
        signupDeviceHash: p.deviceHash,
        signupIpHash: p.ipHash,
        riskScore: Math.min(risk, 100),
        fraudFlags: flags,
      },
    });
  }

  /**
   * Called when a user performs something that could qualify their referral
   * (completed swap, verification, paid plan). Idempotent: the PENDING→QUALIFIED
   * transition is a guarded update, so concurrent calls reward at most once.
   */
  async onQualifyingEvent(userId: string, action: QualifyingAction): Promise<void> {
    const referral = await prisma.referral.findUnique({ where: { referredId: userId } });
    if (!referral || referral.status !== 'PENDING') return;

    const rule = await prisma.referralRule.findFirst({ where: { qualifyingAction: action, isActive: true }, orderBy: { updatedAt: 'desc' } });
    if (!rule) return;

    const referred = await prisma.user.findUnique({ where: { id: userId } });
    if (!referred || referred.successfulSwaps < rule.minCompletedSwaps && action !== 'PAID_PLAN_PURCHASE') return;
    if (action === 'VERIFIED_AND_SWAP' && !(referred.idVerified && referred.successfulSwaps >= 1)) return;

    // Caps protect against farming.
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const [monthly, lifetime] = await Promise.all([
      prisma.referral.count({ where: { referrerId: referral.referrerId, qualifiedAt: { gte: monthStart } } }),
      prisma.referral.count({ where: { referrerId: referral.referrerId, qualifiedAt: { not: null } } }),
    ]);
    const capped = monthly >= rule.monthlyCapPerReferrer || lifetime >= rule.lifetimeCapPerReferrer;
    const needsReview = referral.riskScore >= REVIEW_THRESHOLD || capped;
    const now = new Date();

    const claimed = await prisma.referral.updateMany({
      where: { id: referral.id, status: 'PENDING' },
      data: {
        status: needsReview ? 'UNDER_REVIEW' : 'REWARD_PENDING',
        qualifyingAction: action,
        qualifiedAt: now,
        fraudFlags: capped ? { push: 'CAP_REACHED' } : undefined,
        rewardMinor: rule.rewardType === 'FIXED' ? rule.rewardMinor : null,
        rewardCurrency: rule.currency,
        rewardReleaseAt: new Date(now.getTime() + rule.holdDays * 86_400_000),
      },
    });
    if (claimed.count === 1) logger.info('referral qualified', { referralId: referral.id, action, review: needsReview });
  }

  /** Job: reward becomes payable after the fraud-review hold. Writes an immutable ledger entry once. */
  async releaseDueRewards(now = new Date()): Promise<number> {
    const due = await prisma.referral.findMany({ where: { status: 'REWARD_PENDING', rewardReleaseAt: { lte: now } }, take: 200 });
    let released = 0;
    for (const r of due) {
      if (!r.rewardMinor || !r.rewardCurrency) continue;
      const claimed = await prisma.referral.updateMany({ where: { id: r.id, status: 'REWARD_PENDING' }, data: { status: 'REWARDED', rewardPaidAt: now } });
      if (claimed.count !== 1) continue;
      const entry = await prisma.ledgerEntry
        .create({
          data: {
            entryType: 'REFERRAL_REWARD',
            direction: 'DEBIT',
            amountMinor: r.rewardMinor,
            currency: r.rewardCurrency,
            userId: r.referrerId,
            reference: `referral:${r.id}:reward`,
            description: 'Referral marketing reward (payable by CashMouver)',
          },
        })
        .catch(() => null);
      if (entry) await prisma.referral.update({ where: { id: r.id }, data: { rewardLedgerId: entry.id } });
      released++;
    }
    return released;
  }

  async stats(userId: string): Promise<ReferralSummaryDto> {
    const code = await this.ensureCode(userId);
    const [total, qualified, rewarded, pending, rows] = await Promise.all([
      prisma.referral.count({ where: { referrerId: userId } }),
      prisma.referral.count({ where: { referrerId: userId, qualifiedAt: { not: null } } }),
      prisma.referral.count({ where: { referrerId: userId, status: 'REWARDED' } }),
      prisma.referral.count({ where: { referrerId: userId, status: { in: ['REWARD_PENDING', 'UNDER_REVIEW'] } } }),
      prisma.referral.findMany({ where: { referrerId: userId, status: 'REWARDED', rewardMinor: { not: null } }, select: { rewardMinor: true, rewardCurrency: true } }),
    ]);
    const earned: Record<string, number> = {};
    for (const r of rows) earned[r.rewardCurrency!] = (earned[r.rewardCurrency!] ?? 0) + (r.rewardMinor ?? 0);
    const units = await currencyService.unitMap();
    return {
      code: code.code,
      link: `${config.appUrl}/register?ref=${code.code}`,
      clicks: code.clicks,
      signups: total,
      qualified,
      rewarded,
      pending,
      earnings: Object.entries(earned).map(([currency, minor]) => ({ currency, amount: fromMinor(minor, units.get(currency)) })),
    };
  }

  async list(userId: string, page: number, perPage: number): Promise<{ total: number; items: ReferralItemDto[] }> {
    const [items, total] = await Promise.all([
      prisma.referral.findMany({
        where: { referrerId: userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { referred: { select: { name: true, createdAt: true } } },
      }),
      prisma.referral.count({ where: { referrerId: userId } }),
    ]);
    const units = await currencyService.unitMap();
    return {
      total,
      items: items.map((r): ReferralItemDto => ({
        id: r.id,
        referredName: r.referred.name.split(' ')[0],
        status: r.status,
        qualifyingAction: r.qualifyingAction,
        createdAt: r.createdAt.toISOString(),
        qualifiedAt: r.qualifiedAt?.toISOString() ?? null,
        reward: r.rewardMinor !== null && r.rewardCurrency ? { amount: fromMinor(r.rewardMinor, units.get(r.rewardCurrency)), currency: r.rewardCurrency } : null,
      })),
    };
  }

  async trackClick(code: string): Promise<void> {
    await prisma.referralCode.updateMany({ where: { code: code.toUpperCase(), isActive: true }, data: { clicks: { increment: 1 } } });
  }

  // ───────────── admin ─────────────

  async adminReview(referralId: string, adminId: string, decision: 'APPROVE' | 'REJECT', reason: string) {
    const r = await prisma.referral.findUnique({ where: { id: referralId } });
    if (!r) throw new NotFoundError('Referral not found');
    if (r.status !== 'UNDER_REVIEW') throw new BadRequestError('Referral is not under review');
    const next = decision === 'APPROVE' ? (r.qualifiedAt ? 'REWARD_PENDING' : 'PENDING') : 'REJECTED';
    const res = await prisma.referral.updateMany({ where: { id: referralId, status: 'UNDER_REVIEW' }, data: { status: next } });
    if (res.count !== 1) throw new BadRequestError('Referral already reviewed');
    await auditService.record({ actorId: adminId, action: `referral.${decision.toLowerCase()}`, targetType: 'Referral', targetId: referralId, before: { status: r.status }, after: { status: next }, reason });
  }
}

export const referralService = new ReferralService();
