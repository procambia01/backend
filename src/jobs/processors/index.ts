export * from './email.processor';
export * from './notification.processor';
export * from './exchangeRate.processor';
export * from './expiredOffer.processor';
export * from './swapReminder.processor';
export * from './analytics.processor';

// Initialize all workers
export function initializeWorkers() {
  logger.info('Initializing job workers...');
  // Workers are automatically started when imported
  logger.info('✅ Job workers initialized');
}

// ============================================
// src/services/push.service.ts
// ============================================
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import prisma from '@/config/database';
import logger from '@/utils/logger.util';

export class PushService {
  private expo: Expo;

  constructor() {
    this.expo = new Expo();
  }

  async sendPushNotification(
    userId: string,
    title: string,
    body: string,
    data?: any
  ) {
    try {
      // Get user's push tokens
      const tokens = await prisma.pushToken.findMany({
        where: { userId, isActive: true },
        select: { token: true },
      });

      if (tokens.length === 0) {
        logger.info(`No push tokens found for user ${userId}`);
        return;
      }

      const messages: ExpoPushMessage[] = tokens.map(({ token }) => ({
        to: token,
        sound: 'default',
        title,
        body,
        data,
      }));

      const chunks = this.expo.chunkPushNotifications(messages);
      const tickets = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          logger.error('Error sending push notification chunk:', error);
        }
      }

      logger.info(`Sent ${tickets.length} push notifications to user ${userId}`);
    } catch (error) {
      logger.error('Push notification error:', error);
    }
  }
}