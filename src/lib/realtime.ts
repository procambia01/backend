import type { Server as SocketIOServer } from 'socket.io';

let io: SocketIOServer | null = null;
export const setIo = (server: SocketIOServer) => {
  io = server;
};
/** Best-effort realtime fan-out; persistence always happens first so a missed emit loses nothing. */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}
export function emitToRoom(room: string, event: string, payload: unknown): void {
  io?.to(room).emit(event, payload);
}
