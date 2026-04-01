import { Queue, Worker, QueueScheduler } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '@/config/env';
import logger from '@/utils/logger.util';

// Create Redis connection
const connection = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  maxRetriesPerRequest: null,
});

// Queue definitions
export const emailQueue = new Queue('email', { connection });
export const notificationQueue = new Queue('notification', { connection });
export const exchangeRateQueue = new Queue('exchange-rate', { connection });
export const expiredOfferQueue = new Queue('expired-offer', { connection });
export const swapReminderQueue = new Queue('swap-reminder', { connection });
export const analyticsQueue = new Queue('analytics', { connection });

// Queue schedulers (for delayed/repeated jobs)
export const emailScheduler = new QueueScheduler('email', { connection });
export const notificationScheduler = new QueueScheduler('notification', { connection });
export const exchangeRateScheduler = new QueueScheduler('exchange-rate', { connection });

// Job types
export enum JobType {
  SEND_EMAIL = 'send-email',
  SEND_NOTIFICATION = 'send-notification',
  UPDATE_EXCHANGE_RATES = 'update-exchange-rates',
  EXPIRE_OFFERS = 'expire-offers',
  SEND_SWAP_REMINDER = 'send-swap-reminder',
  CALCULATE_ANALYTICS = 'calculate-analytics',
  VERIFY_PAYMENT = 'verify-payment',
  PROCESS_VERIFICATION = 'process-verification',
}

// Helper functions to add jobs
export async function addEmailJob(data: any, options?: any) {
  return emailQueue.add(JobType.SEND_EMAIL, data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    ...options,
  });
}

export async function addNotificationJob(data: any, options?: any) {
  return notificationQueue.add(JobType.SEND_NOTIFICATION, data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    ...options,
  });
}

export async function addExchangeRateJob(data?: any) {
  return exchangeRateQueue.add(
    JobType.UPDATE_EXCHANGE_RATES,
    data || {},
    {
      repeat: {
        pattern: '0 */6 * * *', // Every 6 hours
      },
    }
  );
}

export async function addExpiredOfferJob() {
  return expiredOfferQueue.add(
    JobType.EXPIRE_OFFERS,
    {},
    {
      repeat: {
        pattern: '0 * * * *', // Every hour
      },
    }
  );
}

export async function addSwapReminderJob(data: any, delay: number) {
  return swapReminderQueue.add(JobType.SEND_SWAP_REMINDER, data, {
    delay, // Delay in milliseconds
  });
}

export async function addAnalyticsJob() {
  return analyticsQueue.add(
    JobType.CALCULATE_ANALYTICS,
    {},
    {
      repeat: {
        pattern: '0 0 * * *', // Daily at midnight
      },
    }
  );
}

// Initialize all queues (call this on startup)
export async function initializeQueues() {
  try {
    logger.info('Initializing job queues...');

    // Set up repeating jobs
    await addExchangeRateJob();
    await addExpiredOfferJob();
    await addAnalyticsJob();

    logger.info('✅ Job queues initialized');
  } catch (error) {
    logger.error('❌ Failed to initialize queues:', error);
    throw error;
  }
}

// Graceful shutdown
export async function closeQueues() {
  await Promise.all([
    emailQueue.close(),
    notificationQueue.close(),
    exchangeRateQueue.close(),
    expiredOfferQueue.close(),
    swapReminderQueue.close(),
    analyticsQueue.close(),
    emailScheduler.close(),
    notificationScheduler.close(),
    exchangeRateScheduler.close(),
  ]);
  await connection.quit();
  logger.info('Queues closed');
}

// Queue event listeners
emailQueue.on('error', (error) => {
  logger.error('Email queue error:', error);
});

notificationQueue.on('error', (error) => {
  logger.error('Notification queue error:', error);
});

// Export connection for workers
export { connection as redisConnection };