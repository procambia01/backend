import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queue';
import logger from '@/utils/logger.util';
import prisma from '@/config/database';

export const expiredOfferWorker = new Worker(
  'expired-offer',
  async (_job: Job) => {
    logger.info('Checking for expired offers...');

    try {
      const expiredOffers = await prisma.swapOffer.updateMany({
        where: {
          status: 'ACTIVE',
          availableUntil: { lt: new Date() },
        },
        data: {
          status: 'EXPIRED',
        },
      });

      logger.info(`Expired ${expiredOffers.count} offers`);
      return { success: true, count: expiredOffers.count };
    } catch (error) {
      logger.error('Expired offer check failed:', error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);
