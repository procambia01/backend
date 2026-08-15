import { Server as SocketIOServer, Socket } from 'socket.io';

export function locationHandler(io: SocketIOServer, socket: Socket) {
  const userId = socket.data.userId;

  // Share live location
  socket.on('location:share', (data: {
    swapId: string;
    latitude: number;
    longitude: number;
  }) => {
    socket.to(`swap:${data.swapId}`).emit('location:update', {
      userId,
      latitude: data.latitude,
      longitude: data.longitude,
      timestamp: new Date(),
    });
  });

  // Stop sharing location
  socket.on('location:stop', (data: { swapId: string }) => {
    socket.to(`swap:${data.swapId}`).emit('location:stopped', { userId });
  });
}