export const swapReminderWorker = new Worker(
  'swap-reminder',
  async (job: Job) => {
    logger.info(`Processing swap reminder: ${job.id}`);

    try {
      const { swapId, userId, type } = job.data;

      const swap = await prisma.swap.findUnique({
        where: { id: swapId },
        include: { initiator: true, receiver: true },
      });

      if (!swap) {
        logger.warn(`Swap ${swapId} not found`);
        return { success: false };
      }

      // Send notification
      const { addNotificationJob } = await import('../queue');
      await addNotificationJob({
        userId,
        type: 'SWAP_REMINDER',
        title: 'Swap Reminder',
        message: `Don't forget to complete your swap`,
        data: { swapId },
        sendPush: true,
      });

      // Update reminder count
      await prisma.swap.update({
        where: { id: swapId },
        data: {
          remindersSent: { increment: 1 },
          lastReminderAt: new Date(),
        },
      });

      return { success: true };
    } catch (error) {
      logger.error(`Swap reminder ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);
