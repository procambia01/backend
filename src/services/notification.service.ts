// src/services/notification.service.ts
import { prisma } from '@/config/database';
import { PaginationParams } from '@/utils/pagination.util';
import { NotificationType } from '@prisma/client';
import { NotFoundError, ForbiddenError } from '@/utils/error.util';
import logger from '@/utils/logger.util';

export class NotificationService {
  /**
   * Send a notification to a user
   */
  async sendNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    link?: string,
    data?: any
  ) {
    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        link,
        data,
      },
    });

    logger.info(`Notification sent to user ${userId}: ${type}`);

    return notification;
  }

  /**
   * Get all notifications for a user
   */
  async getNotifications(userId: string, pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where: { userId } }),
    ]);

    return {
      data: notifications,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
        hasMore: page < Math.ceil(total / perPage),
      },
    };
  }

  /**
   * Get unread notifications for a user
   */
  async getUnreadNotifications(userId: string) {
    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        isRead: false,
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // Limit to latest 50 unread
    });

    return notifications;
  }

  /**
   * Get unread notification count
   */
  async getUnreadCount(userId: string) {
    return prisma.notification.count({
      where: { userId, isRead: false },
    });
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenError('You can only mark your own notifications as read');
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });

    logger.info(`Notification marked as read: ${notificationId}`);
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string) {
    await prisma.notification.updateMany({
      where: {
        userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    logger.info(`All notifications marked as read for user ${userId}`);
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenError('You can only delete your own notifications');
    }

    await prisma.notification.delete({
      where: { id: notificationId },
    });

    logger.info(`Notification deleted: ${notificationId}`);
  }

  /**
   * Delete all notifications for a user
   */
  async deleteAllNotifications(userId: string) {
    const result = await prisma.notification.deleteMany({
      where: { userId },
    });

    logger.info(`Deleted ${result.count} notifications for user ${userId}`);

    return result.count;
  }

  /**
   * Delete all read notifications for a user
   */
  async deleteReadNotifications(userId: string) {
    const result = await prisma.notification.deleteMany({
      where: {
        userId,
        isRead: true,
      },
    });

    logger.info(`Deleted ${result.count} read notifications for user ${userId}`);

    return result.count;
  }

  /**
   * Get notification by ID
   */
  async getNotificationById(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    if (notification.userId !== userId) {
      throw new ForbiddenError('You can only view your own notifications');
    }

    return notification;
  }

  /**
   * Get notifications by type
   */
  async getNotificationsByType(
    userId: string,
    type: NotificationType,
    pagination: PaginationParams
  ) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: {
          userId,
          type,
        },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({
        where: {
          userId,
          type,
        },
      }),
    ]);

    return {
      data: notifications,
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
        hasMore: page < Math.ceil(total / perPage),
      },
    };
  }

  /**
   * Send bulk notifications
   */
  async sendBulkNotifications(
    userIds: string[],
    type: NotificationType,
    title: string,
    message: string,
    link?: string,
    data?: any
  ) {
    const notifications = userIds.map(userId => ({
      userId,
      type,
      title,
      message,
      link,
      data,
    }));

    const result = await prisma.notification.createMany({
      data: notifications,
    });

    logger.info(`Sent ${result.count} bulk notifications`);

    return result.count;
  }

  /**
   * Get notification preferences for a user
   */
  async getNotificationPreferences(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        receiveEmails: true,
        receiveSMS: true,
        receivePush: true,
        notificationPreferences: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  /**
   * Update notification preferences
   */
  async updateNotificationPreferences(
    userId: string,
    preferences: {
      receiveEmails?: boolean;
      receiveSMS?: boolean;
      receivePush?: boolean;
      notificationPreferences?: any;
    }
  ) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: preferences,
      select: {
        receiveEmails: true,
        receiveSMS: true,
        receivePush: true,
        notificationPreferences: true,
      },
    });

    logger.info(`Notification preferences updated for user ${userId}`);

    return user;
  }

  /**
   * Get notification statistics
   */
  async getNotificationStats(userId: string) {
    const [total, unread, byType] = await Promise.all([
      prisma.notification.count({
        where: { userId },
      }),
      prisma.notification.count({
        where: { userId, isRead: false },
      }),
      prisma.notification.groupBy({
        by: ['type'],
        where: { userId },
        _count: {
          type: true,
        },
      }),
    ]);

    return {
      total,
      unread,
      read: total - unread,
      byType: byType.reduce((acc, item) => {
        acc[item.type] = item._count.type;
        return acc;
      }, {} as Record<string, number>),
    };
  }
}