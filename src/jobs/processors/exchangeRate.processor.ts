import { Worker, Job } from 'bullmq';
import { redisConnection } from '../queue';
import { ExchangeRateService } from '@/services/exchangeRate.service';
import logger from '@/utils/logger.util';

const exchangeRateService = new ExchangeRateService();

export const exchangeRateWorker = new Worker(
  'exchange-rate',
  async (_job: Job) => {
    logger.info('Updating exchange rates...');

    try {
      const currencies = ['USD', 'EUR', 'GBP', 'NGN', 'GHS', 'KES', 'ZAR'];
      const rates: { from: string; to: string; rate: number }[] = [];

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
