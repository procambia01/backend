import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '@/config/env';
import { InvalidTokenError, TokenExpiredError } from './error.util';

const toExpiry = (value: string): SignOptions['expiresIn'] => value as SignOptions['expiresIn'];

/** Access-token claims. `sid` ties the token to a revocable server session and
 *  `tv` to the user's tokenVersion, so password changes / "log out everywhere"
 *  invalidate tokens that are still inside their short lifetime. */
export interface AccessClaims {
  sub: string;
  sid: string;
  tv: number;
  role: string;
  email: string;
  type: 'access';
  exp?: number;
  iat?: number;
}

export class JwtUtil {
  static signAccessToken(claims: Omit<AccessClaims, 'type' | 'exp' | 'iat'>): { token: string; expiresAt: Date } {
    const token = jwt.sign({ ...claims, type: 'access' }, config.jwt.secret, {
      expiresIn: toExpiry(config.jwt.accessExpiresIn),
      issuer: config.appName,
      audience: 'cashmouver-api',
      algorithm: 'HS256',
    });
    const decoded = jwt.decode(token) as AccessClaims;
    return { token, expiresAt: new Date((decoded.exp ?? 0) * 1000) };
  }

  static verifyAccessToken(token: string): AccessClaims {
    try {
      const decoded = jwt.verify(token, config.jwt.secret, {
        issuer: config.appName,
        audience: 'cashmouver-api',
        algorithms: ['HS256'],
      }) as AccessClaims;
      if (decoded.type !== 'access' || !decoded.sid || !decoded.sub) throw new InvalidTokenError();
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) throw new TokenExpiredError();
      if (error instanceof InvalidTokenError) throw error;
      throw new InvalidTokenError();
    }
  }

  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader) return null;
    const [scheme, token] = authHeader.split(' ');
    return scheme === 'Bearer' && token ? token : null;
  }
}

/** Parse "15m", "30d" … into milliseconds. */
export function durationToMs(value: string): number {
  const m = /^(\d+)\s*(s|m|h|d)$/.exec(value.trim());
  if (!m) throw new Error(`Invalid duration "${value}"`);
  const n = Number(m[1]);
  return n * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
}

export default JwtUtil;
