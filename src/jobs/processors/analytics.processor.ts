import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queue';
import logger from '@/utils/logger.util';
import prisma from '@/config/database';

export const analyticsWorker = new Worker(
  'analytics',
  async (_job: Job) => {
    logger.info('Calculating daily analytics...');

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [newUsers, activeUsers, swapsCompleted, offersCreated] = await Promise.all([
        prisma.user.count({
          where: { createdAt: { gte: today } },
        }),
        prisma.activityLog.groupBy({
          by: ['userId'],
          where: { createdAt: { gte: today } },
        }),
        prisma.swap.count({
          where: {
            status: 'COMPLETED',
            completedAt: { gte: today },
          },
        }),
        prisma.swapOffer.count({
          where: { createdAt: { gte: today } },
        }),
      ]);

      await Promise.all([
        prisma.analytics.create({
          data: { date: today, metric: 'NEW_USERS', value: newUsers },
        }),
        prisma.analytics.create({
          data: { date: today, metric: 'ACTIVE_USERS', value: activeUsers.length },
        }),
        prisma.analytics.create({
          data: { date: today, metric: 'SWAPS_COMPLETED', value: swapsCompleted },
        }),
        prisma.analytics.create({
          data: { date: today, metric: 'OFFERS_CREATED', value: offersCreated },
        }),
      ]);

      logger.info('Daily analytics calculated');
      return { success: true };
    } catch (error) {
      logger.error('Analytics calculation failed:', error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);
