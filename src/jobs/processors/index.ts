import logger from '@/utils/logger.util';

export * from './email.processor';
export * from './notification.processor';
export * from './exchangeRate.processor';
export * from './expiredOffer.processor';
export * from './swapReminder.processor';
export * from './analytics.processor';

export function initializeWorkers() {
  logger.info('Initializing job workers...');
  // Workers are automatically started when imported
  logger.info('✅ Job workers initialized');
}
