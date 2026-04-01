import { Socket } from 'socket.io';
import { ExtendedError } from 'socket.io/dist/namespace';
import { JwtUtil } from '@/utils/jwt.util';

export async function authenticateSocket(
  socket: Socket,
  next: (err?: ExtendedError) => void
) {
  try {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error('Authentication token required'));
    }

    const decoded = JwtUtil.verifyAccessToken(token);
    socket.data.user = decoded;
    
    next();
  } catch (error) {
    next(new Error('Invalid authentication token'));
  }
}