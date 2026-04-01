import { Server as SocketIOServer, Socket } from 'socket.io';
import { MessageService } from '@/services/message.service';
import logger from '@/utils/logger.util';

const messageService = new MessageService();

export function messageHandler(io: SocketIOServer, socket: Socket) {
  const userId = socket.data.userId;

  // Join swap rooms
  socket.on('swap:join', (data: { swapId: string }) => {
    socket.join(`swap:${data.swapId}`);
    logger.info(`User ${userId} joined swap room: ${data.swapId}`);
  });

  // Leave swap rooms
  socket.on('swap:leave', (data: { swapId: string }) => {
    socket.leave(`swap:${data.swapId}`);
    logger.info(`User ${userId} left swap room: ${data.swapId}`);
  });

  // Send message
  socket.on('message:send', async (data: {
    swapId: string;
    content: string;
    messageType?: string;
  }) => {
    try {
      const message = await messageService.sendMessage(
        userId,
        data.swapId,
        data.content,
        data.messageType
      );

      // Emit to swap room
      io.to(`swap:${data.swapId}`).emit('message:new', {
        message,
        swapId: data.swapId,
      });

      // Acknowledge sender
      socket.emit('message:sent', { messageId: message.id });
    } catch (error) {
      logger.error('Error sending message:', error);
      socket.emit('message:error', { error: 'Failed to send message' });
    }
  });

  // Mark message as read
  socket.on('message:read', async (data: { messageId: string }) => {
    try {
      await messageService.markAsRead(data.messageId, userId);
      
      // Emit to sender
      socket.to(`swap:${data.messageId}`).emit('message:read', {
        messageId: data.messageId,
        readBy: userId,
      });
    } catch (error) {
      logger.error('Error marking message as read:', error);
    }
  });

  // Edit message
  socket.on('message:edit', async (data: {
    messageId: string;
    content: string;
    swapId: string;
  }) => {
    try {
      // Edit logic here
      io.to(`swap:${data.swapId}`).emit('message:edited', {
        messageId: data.messageId,
        content: data.content,
      });
    } catch (error) {
      logger.error('Error editing message:', error);
    }
  });

  // Delete message
  socket.on('message:delete', async (data: {
    messageId: string;
    swapId: string;
  }) => {
    try {
      // Delete logic here
      io.to(`swap:${data.swapId}`).emit('message:deleted', {
        messageId: data.messageId,
      });
    } catch (error) {
      logger.error('Error deleting message:', error);
    }
  });
}
