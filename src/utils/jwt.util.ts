import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '@/config/env';
import { InvalidTokenError, TokenExpiredError } from './error.util';

// config.jwt.expiresIn is a plain string (e.g. "7d") from env vars.
// @types/jsonwebtoken@9 requires StringValue (branded ms type), not string.
// Casting through SignOptions['expiresIn'] is the type-safe workaround.
const toExpiry = (value: string): SignOptions['expiresIn'] => value as SignOptions['expiresIn'];

export interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  type?: 'access' | 'refresh';
  // Standard JWT claims (populated by jsonwebtoken after signing)
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export class JwtUtil {
  /**
   * Generate access token
   */
  static generateAccessToken(payload: Omit<JwtPayload, 'type'>): string {
    return jwt.sign({ ...payload, type: 'access' }, config.jwt.secret, {
      expiresIn: toExpiry(config.jwt.expiresIn),
      issuer: config.appName,
      audience: config.appUrl,
    });
  }

  /**
   * Generate refresh token
   */
  static generateRefreshToken(payload: Omit<JwtPayload, 'type'>): string {
    return jwt.sign({ ...payload, type: 'refresh' }, config.jwt.refreshSecret, {
      expiresIn: toExpiry(config.jwt.refreshExpiresIn),
      issuer: config.appName,
      audience: config.appUrl,
    });
  }

  /**
   * Generate token pair (access + refresh)
   */
  static generateTokenPair(payload: Omit<JwtPayload, 'type'>): TokenPair {
    return {
      accessToken: this.generateAccessToken(payload),
      refreshToken: this.generateRefreshToken(payload),
    };
  }

  /**
   * Verify access token
   */
  static verifyAccessToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, config.jwt.secret, {
        issuer: config.appName,
        audience: config.appUrl,
      }) as JwtPayload;

      if (decoded.type !== 'access') {
        throw new InvalidTokenError();
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredError();
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new InvalidTokenError();
      }
      throw error;
    }
  }

  /**
   * Verify refresh token
   */
  static verifyRefreshToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, config.jwt.refreshSecret, {
        issuer: config.appName,
        audience: config.appUrl,
      }) as JwtPayload;

      if (decoded.type !== 'refresh') {
        throw new InvalidTokenError();
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredError();
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new InvalidTokenError();
      }
      throw error;
    }
  }

  /**
   * Decode token without verification (use with caution)
   */
  static decode(token: string): JwtPayload | null {
    try {
      return jwt.decode(token) as JwtPayload;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get token expiration time
   */
  static getTokenExpiration(token: string): Date | null {
    const decoded = this.decode(token);
    if (!decoded || !decoded.exp) {
      return null;
    }
    return new Date(decoded.exp * 1000);
  }

  /**
   * Check if token is expired
   */
  static isTokenExpired(token: string): boolean {
    const expiration = this.getTokenExpiration(token);
    if (!expiration) {
      return true;
    }
    return expiration < new Date();
  }

  /**
   * Extract token from Authorization header
   */
  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    return parts[1];
  }

  /**
   * Generate email verification token
   */
  static generateEmailVerificationToken(userId: string, email: string): string {
    return jwt.sign({ userId, email, purpose: 'email_verification' }, config.jwt.secret, {
      expiresIn: '24h',
      issuer: config.appName,
    });
  }

  /**
   * Verify email verification token
   */
  static verifyEmailVerificationToken(token: string): { userId: string; email: string } {
    try {
      const decoded = jwt.verify(token, config.jwt.secret, {
        issuer: config.appName,
      }) as any;

      if (decoded.purpose !== 'email_verification') {
        throw new InvalidTokenError();
      }

      return {
        userId: decoded.userId,
        email: decoded.email,
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredError();
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new InvalidTokenError();
      }
      throw error;
    }
  }

  /**
   * Generate password reset token
   */
  static generatePasswordResetToken(userId: string, email: string): string {
    return jwt.sign({ userId, email, purpose: 'password_reset' }, config.jwt.secret, {
      expiresIn: '1h',
      issuer: config.appName,
    });
  }

  /**
   * Verify password reset token
   */
  static verifyPasswordResetToken(token: string): { userId: string; email: string } {
    try {
      const decoded = jwt.verify(token, config.jwt.secret, {
        issuer: config.appName,
      }) as any;

      if (decoded.purpose !== 'password_reset') {
        throw new InvalidTokenError();
      }

      return {
        userId: decoded.userId,
        email: decoded.email,
      };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new TokenExpiredError();
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new InvalidTokenError();
      }
      throw error;
    }
  }
}

export default JwtUtil;
