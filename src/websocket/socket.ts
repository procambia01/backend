import { Server as SocketIOServer, Socket } from 'socket.io';
import { JwtUtil } from '@/utils/jwt.util';
import logger from '@/utils/logger.util';
import { messageHandler } from './handlers/message.handler';
import { notificationHandler } from './handlers/notification.handler';
import { swapHandler } from './handlers/swap.handler';
import { locationHandler } from './handlers/location.handler';

// Store connected users
const connectedUsers = new Map<string, string>(); // userId -> socketId

export function initializeSocket(io: SocketIOServer) {
  // Authentication middleware
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = JwtUtil.verifyAccessToken(token);
      socket.data.userId = decoded.userId;
      socket.data.email = decoded.email;
      socket.data.role = decoded.role;
      
      next();
    } catch (error) {
      logger.error('Socket authentication error:', error);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId;
    
    logger.info(`User connected: ${userId} (${socket.id})`);
    
    // Store user connection
    connectedUsers.set(userId, socket.id);
    
    // Join user's personal room
    socket.join(`user:${userId}`);
    
    // Emit online status
    io.emit('user:online', { userId });

    // Register handlers
    messageHandler(io, socket);
    notificationHandler(io, socket);
    swapHandler(io, socket);
    locationHandler(io, socket);

    // Handle typing indicator
    socket.on('typing:start', (data: { swapId: string }) => {
      socket.to(`swap:${data.swapId}`).emit('typing:start', {
        userId,
        swapId: data.swapId,
      });
    });

    socket.on('typing:stop', (data: { swapId: string }) => {
      socket.to(`swap:${data.swapId}`).emit('typing:stop', {
        userId,
        swapId: data.swapId,
      });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      logger.info(`User disconnected: ${userId} (${socket.id})`);
      connectedUsers.delete(userId);
      io.emit('user:offline', { userId });
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error('Socket error:', error);
    });
  });

  logger.info('✅ WebSocket initialized');
}

// Helper functions
export function getSocketIdByUserId(userId: string): string | undefined {
  return connectedUsers.get(userId);
}

export function isUserOnline(userId: string): boolean {
  return connectedUsers.has(userId);
}

export function getOnlineUsers(): string[] {
  return Array.from(connectedUsers.keys());
}