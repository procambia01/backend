import { NotificationService } from '@/services/notification.service';
import { PushService } from '@/services/push.service';

const notificationService = new NotificationService();
const pushService = new PushService();

export const notificationWorker = new Worker(
  'notification',
  async (job: Job) => {
    logger.info(`Processing notification job: ${job.id}`);

    try {
      const { userId, type, title, message, data, sendPush, sendEmail } = job.data;

      // Create in-app notification
      await notificationService.sendNotification(userId, type, message, data);

      // Send push notification if requested
      if (sendPush) {
        await pushService.sendPushNotification(userId, title, message, data);
      }

      // Send email if requested
      if (sendEmail) {
        // Queue email job
        const { addEmailJob } = await import('../queue');
        await addEmailJob({
          type: 'notification',
          to: data.email,
          data: { name: data.name, message },
        });
      }

      return { success: true };
    } catch (error) {
      logger.error(`Notification job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 10,
  }
);
