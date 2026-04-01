// src/cron/cleanup.cron.ts
import { prisma } from '@/config/database';
import logger from '@/utils/logger.util';

/**
 * Clean up expired data
 */
export async function cleanupExpiredData(): Promise<void> {
  try {
    const now = new Date();

    // Delete expired swap offers
    const deletedOffers = await prisma.swapOffer.deleteMany({
      where: {
        expiresAt: {
          lt: now,
        },
        status: 'EXPIRED',
      },
    });
    logger.info(`Deleted ${deletedOffers.count} expired offers`);

    // Delete expired sessions
    const deletedSessions = await prisma.session.deleteMany({
      where: {
        expires: {
          lt: now,
        },
      },
    });
    logger.info(`Deleted ${deletedSessions.count} expired sessions`);

    // Delete old notifications (older than 90 days)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const deletedNotifications = await prisma.notification.deleteMany({
      where: {
        createdAt: {
          lt: ninetyDaysAgo,
        },
        isRead: true,
      },
    });
    logger.info(`Deleted ${deletedNotifications.count} old notifications`);

    // Mark expired premium subscriptions
    const expiredPremium = await prisma.user.updateMany({
      where: {
        isPremium: true,
        premiumExpiry: {
          lt: now,
        },
      },
      data: {
        isPremium: false,
        premiumTier: null,
      },
    });
    logger.info(`Expired ${expiredPremium.count} premium subscriptions`);

    logger.info('Data cleanup completed successfully');
  } catch (error) {
    logger.error('Data cleanup error:', error);
    throw error;
  }
}