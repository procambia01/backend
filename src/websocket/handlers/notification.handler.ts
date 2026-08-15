import { Server as SocketIOServer, Socket } from 'socket.io';
import { NotificationService } from '@/services/notification.service';
import logger from '@/utils/logger.util';

const notificationService = new NotificationService();

export function notificationHandler(io: SocketIOServer, socket: Socket) {
  const userId = socket.data.userId;

  // Mark notification as read
  socket.on('notification:read', async (data: { notificationId: string }) => {
    try {
      await notificationService.markAsRead(data.notificationId, userId);
      socket.emit('notification:read:success', { notificationId: data.notificationId });
    } catch (error) {
      logger.error('Error marking notification as read:', error);
    }
  });

  // Request notifications
  socket.on('notification:fetch', async () => {
    try {
      const notifications = await notificationService.getNotifications(
        userId,
        { page: 1, perPage: 20 }
      );
      socket.emit('notification:list', notifications);
    } catch (error) {
      logger.error('Error fetching notifications:', error);
    }
  });
}

// Helper to send notification to user
export async function sendNotificationToUser(
  io: SocketIOServer,
  userId: string,
  notification: any
) {
  io.to(`user:${userId}`).emit('notification:new', notification);
}