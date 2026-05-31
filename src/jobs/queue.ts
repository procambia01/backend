import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from '@/config/env';
import logger from '@/utils/logger.util';

// ── Shared BullMQ Redis connection ────────────────────────
// Uses REDIS_URL (rediss://) when set — required for Upstash TLS.
// maxRetriesPerRequest MUST be null for BullMQ.
const connectionOptions = config.redis.url
  ? {
      // Parse from URL — ioredis handles rediss:// TLS automatically
      lazyConnect: false,
      maxRetriesPerRequest: null as null,
      enableReadyCheck: false,
      tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
    }
  : {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      db: config.redis.db,
      maxRetriesPerRequest: null as null,
      enableReadyCheck: false,
    };

export const connection = config.redis.url
  ? new Redis(config.redis.url, connectionOptions as object)
  : new Redis(connectionOptions as object);

connection.on('error', (e) => logger.warn('BullMQ Redis error:', e.message));

// ── Queue definitions ─────────────────────────────────────
const queueOpts = { connection };

export const emailQueue = new Queue('email', queueOpts);
export const notificationQueue = new Queue('notification', queueOpts);
export const exchangeRateQueue = new Queue('exchange-rate', queueOpts);
export const expiredOfferQueue = new Queue('expired-offer', queueOpts);
export const swapReminderQueue = new Queue('swap-reminder', queueOpts);
export const analyticsQueue = new Queue('analytics', queueOpts);

// ── Job type enum ─────────────────────────────────────────
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

// ── Queue error listeners ─────────────────────────────────
emailQueue.on('error', (e) => logger.error('Email queue error:', e.message));
notificationQueue.on('error', (e) => logger.error('Notification queue error:', e.message));

// ── Job helpers ───────────────────────────────────────────
export async function addEmailJob(data: unknown, options?: object) {
  return emailQueue.add(JobType.SEND_EMAIL, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    ...options,
  });
}

export async function addNotificationJob(data: unknown, options?: object) {
  return notificationQueue.add(JobType.SEND_NOTIFICATION, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    ...options,
  });
}

export async function addExchangeRateJob(data?: unknown) {
  return exchangeRateQueue.add(JobType.UPDATE_EXCHANGE_RATES, data || {}, {
    repeat: { pattern: '0 */6 * * *' },
  });
}

export async function addExpiredOfferJob() {
  return expiredOfferQueue.add(JobType.EXPIRE_OFFERS, {}, { repeat: { pattern: '0 * * * *' } });
}

export async function addSwapReminderJob(data: unknown, delay: number) {
  return swapReminderQueue.add(JobType.SEND_SWAP_REMINDER, data, { delay });
}

export async function addAnalyticsJob() {
  return analyticsQueue.add(JobType.CALCULATE_ANALYTICS, {}, { repeat: { pattern: '0 0 * * *' } });
}

// ── Startup initializer ───────────────────────────────────
export async function initializeQueues() {
  try {
    logger.info('Initializing job queues...');
    await Promise.all([addExchangeRateJob(), addExpiredOfferJob(), addAnalyticsJob()]);
    logger.info('✅ Job queues initialized');
  } catch (error) {
    // Non-fatal — queues are a background feature
    logger.warn('⚠️ Job queues could not be initialized (non-fatal):', (error as Error).message);
  }
}

// ── Graceful shutdown ─────────────────────────────────────
export async function closeQueues() {
  await Promise.allSettled([
    emailQueue.close(),
    notificationQueue.close(),
    exchangeRateQueue.close(),
    expiredOfferQueue.close(),
    swapReminderQueue.close(),
    analyticsQueue.close(),
  ]);
  await connection.quit();
  logger.info('Queues closed');
}

// Alias for processor imports
export { connection as redisConnection };
