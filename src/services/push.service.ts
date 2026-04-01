// src/services/push.service.ts
import { prisma } from '@/config/database';
import logger from '@/utils/logger.util';

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export class PushService {
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    const tokens = await prisma.pushToken.findMany({
      where: { userId, isActive: true },
      select: { token: true, platform: true },
    });

    if (tokens.length === 0) return;

    // Expo push notification batch
    const messages = tokens.map(t => ({
      to:    t.token,
      title: payload.title,
      body:  payload.body,
      data:  payload.data ?? {},
      sound: 'default',
    }));

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body:    JSON.stringify(messages),
      });
      if (!response.ok) throw new Error(`Expo push failed: ${response.status}`);
      logger.info(`Push sent to user ${userId} (${tokens.length} device(s))`);
    } catch (err) {
      logger.error('Push notification error:', err);
    }
  }

  async registerToken(userId: string, token: string, platform: string, deviceId?: string) {
    await prisma.pushToken.upsert({
      where: { token },
      update: { isActive: true, lastUsedAt: new Date(), userId },
      create: { userId, token, platform, deviceId, isActive: true },
    });
  }

  async deactivateToken(token: string) {
    await prisma.pushToken.updateMany({
      where: { token },
      data:  { isActive: false },
    });
  }
}
