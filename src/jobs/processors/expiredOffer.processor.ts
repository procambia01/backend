export const expiredOfferWorker = new Worker(
  'expired-offer',
  async (job: Job) => {
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