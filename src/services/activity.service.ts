import type { ActivityType } from '@prisma/client';
import { prisma } from '@/config/database';
import { getContext } from '@/lib/request-context';
import { redact } from '@/lib/redact';
import logger from '@/utils/logger.util';

export async function logActivity(userId: string, action: ActivityType, description: string, metadata?: Record<string, unknown>) {
  const ctx = getContext();
  try {
    await prisma.activityLog.create({
      data: { userId, action, description, metadata: metadata ? (redact(metadata) as object) : undefined, ipAddress: ctx?.ip, userAgent: ctx?.userAgent },
    });
  } catch (error) {
    logger.warn('activity log failed', { message: (error as Error).message });
  }
}
