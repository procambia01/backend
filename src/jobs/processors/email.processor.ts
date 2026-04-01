import { Worker, Job } from 'bullmq';
import { redisConnection, JobType } from '../queue';
import { EmailService } from '@/services/email.service';
import logger from '@/utils/logger.util';

const emailService = new EmailService();

export const emailWorker = new Worker(
  'email',
  async (job: Job) => {
    logger.info(`Processing email job: ${job.id}`);

    try {
      const { type, to, data } = job.data;

      switch (type) {
        case 'verification':
          await emailService.sendVerificationEmail(to, data.name, data.token);
          break;
        case 'password-reset':
          await emailService.sendPasswordResetEmail(to, data.name, data.token);
          break;
        case 'swap-notification':
          await emailService.sendSwapNotification(to, data.name, data.swapDetails);
          break;
        default:
          logger.warn(`Unknown email type: ${type}`);
      }

      logger.info(`Email job ${job.id} completed`);
      return { success: true };
    } catch (error) {
      logger.error(`Email job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

emailWorker.on('completed', (job) => {
  logger.info(`Email job ${job.id} completed`);
});

emailWorker.on('failed', (job, err) => {
  logger.error(`Email job ${job?.id} failed:`, err);
});