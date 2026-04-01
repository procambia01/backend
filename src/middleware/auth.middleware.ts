import { Request, Response, NextFunction } from 'express';
import { JwtUtil } from '@/utils/jwt.util';
import { UnauthorizedError, AccountBannedError, AccountSuspendedError } from '@/utils/error.util';
import { prisma } from '@/config/database';
import redisClient from '@/config/redis';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        role: string;
      };
    }
  }
}

export class AuthMiddleware {
  /**
   * Verify JWT token and attach user to request
   */
  static async authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      // Extract token from header
      const authHeader = req.headers.authorization;
      const token = JwtUtil.extractTokenFromHeader(authHeader);

      if (!token) {
        throw new UnauthorizedError('No token provided');
      }

      // Check if token is blacklisted
      const isBlacklisted = await redisClient.exists(`blacklist:${token}`);
      if (isBlacklisted) {
        throw new UnauthorizedError('Token has been revoked');
      }

      // Verify token
      const decoded = JwtUtil.verifyAccessToken(token);

      // Get user from database
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          isBanned: true,
          isSuspended: true,
          banReason: true,
          suspensionReason: true,
          deletedAt: true,
        },
      });

      if (!user || user.deletedAt) {
        throw new UnauthorizedError('User not found');
      }

      if (!user.isActive) {
        throw new UnauthorizedError('Account is not active');
      }

      if (user.isBanned) {
        throw new AccountBannedError(user.banReason || undefined);
      }

      if (user.isSuspended) {
        throw new AccountSuspendedError();
      }

      // Attach user to request
      req.user = {
        userId: user.id,
        email: user.email,
        role: user.role,
      };

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Optional authentication - doesn't fail if no token
   */
  static async optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      const token = JwtUtil.extractTokenFromHeader(authHeader);

      if (token) {
        const decoded = JwtUtil.verifyAccessToken(token);

        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            isBanned: true,
            isSuspended: true,
            deletedAt: true,
          },
        });

        if (user && !user.deletedAt && user.isActive && !user.isBanned && !user.isSuspended) {
          req.user = {
            userId: user.id,
            email: user.email,
            role: user.role,
          };
        }
      }

      next();
    } catch (error) {
      // Don't throw error, just continue without user
      next();
    }
  }

  /**
   * Verify email is verified
   */
  static async requireEmailVerified(
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { emailVerified: true },
      });

      if (!user?.emailVerified) {
        throw new UnauthorizedError('Please verify your email address');
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify phone is verified
   */
  static async requirePhoneVerified(
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { phoneVerified: true },
      });

      if (!user?.phoneVerified) {
        throw new UnauthorizedError('Please verify your phone number');
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify ID is verified
   */
  static async requireIdVerified(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { idVerified: true, verificationStatus: true },
      });

      if (!user?.idVerified || user.verificationStatus !== 'VERIFIED') {
        throw new UnauthorizedError('ID verification required');
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify user is premium
   */
  static async requirePremium(req: Request, _res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.userId },
        select: { isPremium: true, premiumExpiry: true },
      });

      if (!user?.isPremium) {
        throw new UnauthorizedError('Premium subscription required');
      }

      // Check if premium expired
      if (user.premiumExpiry && user.premiumExpiry < new Date()) {
        throw new UnauthorizedError('Premium subscription has expired');
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Blacklist token (for logout)
   */
  static async blacklistToken(token: string, expiresIn: number): Promise<void> {
    await redisClient.set(`blacklist:${token}`, 'true', expiresIn);
  }

  /**
   * Rate limit by user
   */
  static async rateLimitByUser(
    req: Request,
    res: Response,
    next: NextFunction,
    maxRequests: number = 100,
    windowInSeconds: number = 60
  ): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const key = `ratelimit:user:${req.user.userId}`;
      const requests = await redisClient.increment(key);

      if (requests === 1) {
        await redisClient.expire(key, windowInSeconds);
      }

      if (requests > maxRequests) {
        throw new UnauthorizedError('Rate limit exceeded');
      }

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - requests));
      res.setHeader('X-RateLimit-Reset', Date.now() + windowInSeconds * 1000);

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check if user owns resource
   */
  static checkOwnership(userIdField: string = 'userId') {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.user) {
          throw new UnauthorizedError('Authentication required');
        }

        const resourceUserId = req.body[userIdField] || req.params[userIdField];

        if (!resourceUserId) {
          return next();
        }

        if (resourceUserId !== req.user.userId) {
          // Allow admins to bypass
          if (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') {
            return next();
          }

          throw new UnauthorizedError('You do not have permission to access this resource');
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Refresh token middleware
   */
  static async refreshToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw new UnauthorizedError('Refresh token required');
      }

      // Verify refresh token
      const decoded = JwtUtil.verifyRefreshToken(refreshToken);

      // Get user
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          isBanned: true,
          isSuspended: true,
          deletedAt: true,
        },
      });

      if (!user || user.deletedAt || !user.isActive || user.isBanned || user.isSuspended) {
        throw new UnauthorizedError('Invalid refresh token');
      }

      // Generate new tokens
      const tokens = JwtUtil.generateTokenPair({
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      res.json({
        success: true,
        message: 'Token refreshed successfully',
        data: tokens,
      });
    } catch (error) {
      next(error);
    }
  }
}

// Export middleware functions
export const authenticate = AuthMiddleware.authenticate;
export const optionalAuth = AuthMiddleware.optionalAuth;
export const requireEmailVerified = AuthMiddleware.requireEmailVerified;
export const requirePhoneVerified = AuthMiddleware.requirePhoneVerified;
export const requireIdVerified = AuthMiddleware.requireIdVerified;
export const requirePremium = AuthMiddleware.requirePremium;
export const checkOwnership = AuthMiddleware.checkOwnership;
export const refreshToken = AuthMiddleware.refreshToken;

export default AuthMiddleware;
