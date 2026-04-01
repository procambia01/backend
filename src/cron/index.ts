// src/cron/index.ts
import cron from 'node-cron';
import { config } from '@/config/env';
import logger from '@/utils/logger.util';
import { updateExchangeRates } from './exchangeRate.cron';
import { cleanupExpiredData } from './cleanup.cron';

/**
 * Initialize all cron jobs
 */
export function initializeCronJobs(): void {
  logger.info('🕐 Initializing cron jobs...');

  // Update exchange rates every 6 hours
  cron.schedule(config.cron.exchangeRateUpdate, async () => {
    try {
      logger.info('Running exchange rate update cron job...');
      await updateExchangeRates();
      logger.info('✅ Exchange rate update completed');
    } catch (error) {
      logger.error('❌ Exchange rate update failed:', error);
    }
  });

  // Cleanup expired data daily at 2 AM
  cron.schedule(config.cron.cleanup, async () => {
    try {
      logger.info('Running cleanup cron job...');
      await cleanupExpiredData();
      logger.info('✅ Cleanup completed');
    } catch (error) {
      logger.error('❌ Cleanup failed:', error);
    }
  });

  logger.info('✅ All cron jobs initialized');
}