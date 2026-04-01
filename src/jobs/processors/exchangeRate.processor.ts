import { ExchangeRateService } from '@/services/exchangeRate.service';
import prisma from '@/config/database';

const exchangeRateService = new ExchangeRateService();

export const exchangeRateWorker = new Worker(
  'exchange-rate',
  async (job: Job) => {
    logger.info('Updating exchange rates...');

    try {
      const currencies = ['USD', 'EUR', 'GBP', 'NGN', 'GHS', 'KES', 'ZAR'];
      const rates: any[] = [];

      // Fetch rates for all currency pairs
      for (const from of currencies) {
        for (const to of currencies) {
          if (from !== to) {
            try {
              const rate = await exchangeRateService.getRate(from, to);
              rates.push({ from, to, rate });
            } catch (error) {
              logger.error(`Failed to fetch rate ${from}-${to}:`, error);
            }
          }
        }
      }

      logger.info(`Updated ${rates.length} exchange rates`);
      return { success: true, count: rates.length };
    } catch (error) {
      logger.error('Exchange rate update failed:', error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);
