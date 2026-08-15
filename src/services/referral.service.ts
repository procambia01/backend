// src/services/referral.service.ts
import { prisma } from '@/config/database';
import { NotFoundError, BadRequestError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { nanoid } from 'nanoid';
import { NotificationType, ReferralStatus, TransactionType, TransactionStatus } from '@prisma/client';
import { MONETIZATION } from '@/config/monetization';

export class ReferralService {
  /**
   * Generate a unique referral code
   */
  private generateReferralCode(): string {
    return nanoid(10).toUpperCase();
  }

  /**
   * Create or get user's referral code
   */
  async getMyReferralCode(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        id: true,
        name: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Check if user already has referrals as a referrer
    const existingReferral = await prisma.referral.findFirst({
      where: { referrerId: userId },
      select: { code: true },
    });

    if (existingReferral) {
      return existingReferral.code;
    }

    // Generate new code
    const code = this.generateReferralCode();
    
    logger.info(`Generated referral code ${code} for user ${userId}`);
    
    return code;
  }

  /**
   * Apply referral code when user signs up
   */
  async applyReferralCode(userId: string, code: string) {
    // Find referrer by checking existing referral codes
    const referrerReferral = await prisma.referral.findFirst({
      where: { code },
      select: { referrerId: true },
    });

    if (!referrerReferral) {
      throw new BadRequestError('Invalid referral code');
    }

    const referrerId = referrerReferral.referrerId;

    // Check if user is trying to refer themselves
    if (referrerId === userId) {
      throw new BadRequestError('You cannot use your own referral code');
    }

    // Check if user has already been referred
    const existingReferral = await prisma.referral.findFirst({
      where: { referredId: userId },
    });

    if (existingReferral) {
      throw new BadRequestError('You have already used a referral code');
    }

    // Create referral relationship
    const referral = await prisma.referral.create({
      data: {
        referrerId,
        referredId: userId,
        code,
        status: ReferralStatus.PENDING,
      },
      include: {
        referrer: {
          select: {
            id: true,
            name: true,
          },
        },
        referred: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Send notification to referrer
    await prisma.notification.create({
      data: {
        userId: referrerId,
        type: NotificationType.SYSTEM_ALERT,
        title: 'New Referral',
        message: `${referral.referred.name} signed up using your referral code!`,
        link: `/referrals`,
      },
    });

    logger.info(`Referral created: ${userId} referred by ${referrerId}`);

    return referral;
  }

  /**
   * Get referral statistics
   */
  async getReferralStats(userId: string) {
    const [total, byStatus, earnings] = await Promise.all([
      prisma.referral.count({
        where: { referrerId: userId },
      }),
      prisma.referral.groupBy({
        by: ['status'],
        where: { referrerId: userId },
        _count: {
          status: true,
        },
      }),
      prisma.referral.aggregate({
        where: { 
          referrerId: userId,
          status: ReferralStatus.COMPLETED,
        },
        _sum: {
          referrerReward: true,
        },
      }),
    ]);

    return {
      total,
      breakdown: byStatus.reduce((acc, item) => {
        acc[item.status] = item._count.status;
        return acc;
      }, {} as Record<string, number>),
      totalEarnings: earnings._sum?.referrerReward || 0,
    };
  }

  /**
   * Get list of referred users
   */
  async getReferredUsers(userId: string) {
    const referrals = await prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referred: {
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
            image: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return referrals.map(referral => ({
      id: referral.id,
      user: referral.referred,
      code: referral.code,
      status: referral.status,
      reward: referral.referrerReward,
      createdAt: referral.createdAt,
      completedAt: referral.completedAt,
    }));
  }

  /**
   * Validate if a referral code exists and is active
   */
  async validateReferralCode(code: string): Promise<boolean> {
    const referral = await prisma.referral.findFirst({
      where: { code },
    });

    return !!referral;
  }

  /**
   * Mark referral as completed and award rewards
   */
  async completeReferral(referredId: string) {
    const referral = await prisma.referral.findFirst({
      where: {
        referredId,
        status: ReferralStatus.PENDING,
      },
    });

    if (!referral) {
      return; // no pending referral — not an error, just nothing to do
    }

    const referrerReward = MONETIZATION.referral.referrerRewardUSD;
    // The referred user's reward is the waived platform fee on this swap
    // (applied separately in FeeService), so we don't double-credit here.
    const referredReward = 0;

    await prisma.$transaction([
      prisma.referral.update({
        where: { id: referral.id },
        data: {
          status: ReferralStatus.COMPLETED,
          referrerReward,
          referredReward,
          completedAt: new Date(),
        },
      }),
      // Real, queryable record of the referrer's earned credit — this is
      // what powers "Referral Earnings" in the referrer's dashboard and
      // is what an admin would reconcile against actual payouts.
      prisma.transaction.create({
        data: {
          userId: referral.referrerId,
          type: TransactionType.REFERRAL_BONUS,
          amount: referrerReward,
          currency: 'USD',
          description: `Referral bonus — ${referredId} completed their first swap`,
          status: TransactionStatus.COMPLETED,
          completedAt: new Date(),
          metadata: { referralId: referral.id, referredId },
        },
      }),
    ]);

    await Promise.all([
      prisma.notification.create({
        data: {
          userId: referral.referrerId,
          type: NotificationType.SYSTEM_ALERT,
          title: 'Referral reward earned!',
          message: `You've earned $${referrerReward.toFixed(2)} credit — your referral completed their first swap.`,
          link: `/referrals`,
        },
      }),
      prisma.notification.create({
        data: {
          userId: referredId,
          type: NotificationType.SYSTEM_ALERT,
          title: 'Welcome bonus applied!',
          message: `Your first swap's platform fee was waived as a welcome bonus.`,
          link: `/profile`,
        },
      }),
    ]);

    logger.info(`Referral completed: ${referral.id}, referrer credited $${referrerReward}`);
  }

  /**
   * Get referral leaderboard
   */
  async getReferralLeaderboard(limit: number = 10) {
    const leaderboard = await prisma.referral.groupBy({
      by: ['referrerId'],
      where: {
        status: ReferralStatus.COMPLETED,
      },
      _count: {
        referrerId: true,
      },
      _sum: {
        referrerReward: true,
      },
      orderBy: {
        _count: {
          referrerId: 'desc',
        },
      },
      take: limit,
    });

    // Get user details
    const userIds = leaderboard.map(item => item.referrerId);
    const users = await prisma.user.findMany({
      where: {
        id: { in: userIds },
      },
      select: {
        id: true,
        name: true,
        image: true,
      },
    });

    const userMap = new Map(users.map(user => [user.id, user]));

    return leaderboard.map(item => ({
      user: userMap.get(item.referrerId),
      referrals: item._count?.referrerId || 0,
      totalEarnings: item._sum?.referrerReward || 0,
    }));
  }

  /**
   * Get referral by code
   */
  async getReferralByCode(code: string) {
    const referral = await prisma.referral.findFirst({
      where: { code },
      include: {
        referrer: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    if (!referral) {
      throw new NotFoundError('Referral code not found');
    }

    return referral;
  }

  /**
   * Mark referral as rewarded
   */
  async markAsRewarded(referralId: string) {
    await prisma.referral.update({
      where: { id: referralId },
      data: {
        status: ReferralStatus.REWARDED,
        rewardPaidAt: new Date(),
      },
    });

    logger.info(`Referral marked as rewarded: ${referralId}`);
  }

  /**
   * Get user's referral earnings
   */
  async getReferralEarnings(userId: string) {
    const earnings = await prisma.referral.aggregate({
      where: {
        referrerId: userId,
        status: {
          in: [ReferralStatus.COMPLETED, ReferralStatus.REWARDED],
        },
      },
      _sum: {
        referrerReward: true,
      },
      _count: true,
    });

    return {
      totalEarnings: earnings._sum?.referrerReward || 0,
      totalReferrals: earnings._count,
    };
  }
}