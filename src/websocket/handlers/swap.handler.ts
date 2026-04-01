import { SwapService } from '@/services/swap.service';

const swapService = new SwapService();

export function swapHandler(io: SocketIOServer, socket: Socket) {
  const userId = socket.data.userId;

  // Swap status update
  socket.on('swap:status', async (data: {
    swapId: string;
    status: string;
  }) => {
    try {
      // Emit status update to both parties
      io.to(`swap:${data.swapId}`).emit('swap:status:updated', {
        swapId: data.swapId,
        status: data.status,
        updatedBy: userId,
      });
    } catch (error) {
      logger.error('Error updating swap status:', error);
    }
  });

  // Swap confirmation
  socket.on('swap:confirm', async (data: {
    swapId: string;
    type: 'sent' | 'received';
  }) => {
    try {
      if (data.type === 'sent') {
        await swapService.confirmSent(data.swapId, userId);
      } else {
        await swapService.confirmReceived(data.swapId, userId);
      }

      io.to(`swap:${data.swapId}`).emit('swap:confirmed', {
        swapId: data.swapId,
        type: data.type,
        confirmedBy: userId,
      });
    } catch (error) {
      logger.error('Error confirming swap:', error);
    }
  });

  // Meetup time update
  socket.on('swap:meetup:update', async (data: {
    swapId: string;
    meetupTime: string;
    meetupLocation: string;
  }) => {
    try {
      io.to(`swap:${data.swapId}`).emit('swap:meetup:updated', {
        swapId: data.swapId,
        ...data,
        updatedBy: userId,
      });
    } catch (error) {
      logger.error('Error updating meetup:', error);
    }
  });
}
