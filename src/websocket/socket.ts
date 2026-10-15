import { Server as SocketIOServer, Socket } from 'socket.io';
import { prisma } from '@/config/database';
import { JwtUtil } from '@/utils/jwt.util';
import logger from '@/utils/logger.util';
import { setIo } from '@/lib/realtime';

/**
 * Realtime is a notification channel only: every state change is persisted by
 * the REST API first. Sockets authenticate with the same short-lived access
 * token, are tied to a live session, and may only join rooms for swaps they
 * take part in. No global presence is broadcast (privacy).
 */
export function initializeSocket(io: SocketIOServer): void {
  setIo(io);

  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.auth?.token ?? JwtUtilHeader(socket);
      const claims = JwtUtil.verifyAccessToken(String(raw));
      const [session, user] = await Promise.all([
        prisma.authSession.findUnique({ where: { id: claims.sid } }),
        prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, tokenVersion: true, isActive: true, isBanned: true, deletedAt: true } }),
      ]);
      if (!session || session.revokedAt || session.expiresAt <= new Date() || !user || !user.isActive || user.isBanned || user.deletedAt || user.tokenVersion !== claims.tv) {
        return next(new Error('unauthorized'));
      }
      socket.data.userId = user.id;
      socket.data.sessionId = session.id;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId as string;
    void socket.join(`user:${userId}`);

    socket.on('swap:join', async (swapId: unknown, ack?: (r: { ok: boolean }) => void) => {
      if (typeof swapId !== 'string' || !/^[a-f0-9]{24}$/i.test(swapId)) return ack?.({ ok: false });
      const swap = await prisma.swap.findFirst({ where: { id: swapId, OR: [{ initiatorId: userId }, { receiverId: userId }] }, select: { id: true } });
      if (!swap) return ack?.({ ok: false });
      await socket.join(`swap:${swapId}`);
      ack?.({ ok: true });
    });
    socket.on('swap:leave', (swapId: unknown) => {
      if (typeof swapId === 'string') void socket.leave(`swap:${swapId}`);
    });
    socket.on('typing', (p: { swapId?: string; typing?: boolean }) => {
      if (!p?.swapId || !socket.rooms.has(`swap:${p.swapId}`)) return;
      socket.to(`swap:${p.swapId}`).emit('typing', { swapId: p.swapId, userId, typing: !!p.typing });
    });
    socket.on('disconnect', () => logger.debug('socket disconnected', { userId }));
  });
}

function JwtUtilHeader(socket: Socket): string {
  return JwtUtil.extractTokenFromHeader(socket.handshake.headers.authorization) ?? '';
}
