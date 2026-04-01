import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { Request, Response } from 'express';
import redisClient from '@/config/redis';
import { config } from '@/config/env';
import { TooManyRequestsError } from '@/utils/error.util';

export class RateLimitMiddleware {
  /**
   * General API rate limiter
   */
  static general = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:general:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('Too many requests, please try again later');
    },
    skip: (req: Request) => {
      // Skip rate limiting for super admins
      return req.user?.role === 'SUPER_ADMIN';
    },
  });

  /**
   * Strict rate limiter for authentication routes
   */
  static auth = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:auth:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('Too many authentication attempts, please try again later');
    },
    keyGenerator: (req: Request) => {
      // Rate limit by IP and email/phone if provided
      const identifier = req.body.email || req.body.phone || req.ip;
      return `${identifier}`;
    },
  });

  /**
   * Rate limiter for login attempts
   */
  static login = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:login:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('Too many login attempts, please try again in 15 minutes');
    },
    keyGenerator: (req: Request) => {
      return req.body.email || req.ip || 'unknown';
    },
  });

  /**
   * Rate limiter for registration
   */
  static register = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:register:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('Too many registration attempts, please try again later');
    },
    keyGenerator: (req: Request) => {
      return req.ip || 'unknown';
    },
  });

  /**
   * Rate limiter for password reset
   */
  static passwordReset = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:password-reset:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('Too many password reset attempts, please try again later');
    },
    keyGenerator: (req: Request) => {
      return req.body.email || req.ip || 'unknown';
    },
  });

  /**
   * Rate limiter for email verification
   */
  static emailVerification = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:email-verify:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('Too many verification attempts, please try again later');
    },
  });

  /**
   * Rate limiter for SMS sending
   */
  static sms = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:sms:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('Too many SMS requests, please try again later');
    },
  });

  /**
   * Rate limiter for file uploads
   */
  static upload = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:upload:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('Too many upload attempts, please try again later');
    },
    skip: (req: Request) => {
      // Skip for premium users
      return req.user?.role === 'PREMIUM' || req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
    },
  });

  /**
   * Rate limiter for creating offers
   */
  static createOffer = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 offers per hour
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:create-offer:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('Too many offers created, please try again later');
    },
    keyGenerator: (req: Request) => {
      return req.user?.userId || req.ip || 'unknown';
    },
    skip: (req: Request) => {
      // Premium users get higher limits
      return req.user?.role === 'PREMIUM' || req.user?.role === 'BUSINESS';
    },
  });

  /**
   * Rate limiter for initiating swaps
   */
  static initiateSwap = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20, // 20 swap requests per hour
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:initiate-swap:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('Too many swap requests, please try again later');
    },
    keyGenerator: (req: Request) => {
      return req.user?.userId || req.ip || 'unknown';
    },
  });

  /**
   * Rate limiter for sending messages
   */
  static sendMessage = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 messages per minute
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:send-message:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('Too many messages sent, please slow down');
    },
    keyGenerator: (req: Request) => {
      return req.user?.userId || req.ip || 'unknown';
    },
  });

  /**
   * Rate limiter for API key requests
   */
  static apiKey = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute for API keys
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      client: redisClient.getClient() as any,
      prefix: 'rl:api-key:',
    }),
    handler: (req: Request, res: Response) => {
      throw new TooManyRequestsError('API rate limit exceeded');
    },
    keyGenerator: (req: Request) => {
      return req.headers['x-api-key'] as string || req.ip || 'unknown';
    },
  });

  /**
   * Custom rate limiter
   */
  static custom(options: {
    windowMs: number;
    max: number;
    prefix?: string;
    message?: string;
    skipSuccessfulRequests?: boolean;
    keyGenerator?: (req: Request) => string;
  }) {
    return rateLimit({
      windowMs: options.windowMs,
      max: options.max,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: options.skipSuccessfulRequests || false,
      store: new RedisStore({
        client: redisClient.getClient() as any,
        prefix: options.prefix || 'rl:custom:',
      }),
      handler: (req: Request, res: Response) => {
        throw new TooManyRequestsError(options.message || 'Rate limit exceeded');
      },
      keyGenerator: options.keyGenerator || ((req: Request) => req.ip || 'unknown'),
    });
  }

  /**
   * Sliding window rate limiter (more accurate)
   */
  static slidingWindow(options: {
    windowMs: number;
    max: number;
    prefix?: string;
  }) {
    return async (req: Request, res: Response, next: Function) => {
      const key = `${options.prefix || 'rl:sliding:'}${req.user?.userId || req.ip}`;
      const now = Date.now();
      const windowStart = now - options.windowMs;

      try {
        // Remove old entries
        await redisClient.getClient().zremrangebyscore(key, 0, windowStart);

        // Count current requests in window
        const count = await redisClient.getClient().zcard(key);

        if (count >= options.max) {
          throw new TooManyRequestsError('Rate limit exceeded');
        }

        // Add current request
        await redisClient.getClient().zadd(key, now, `${now}`);
        await redisClient.getClient().expire(key, Math.ceil(options.windowMs / 1000));

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', options.max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, options.max - count - 1));
        res.setHeader('X-RateLimit-Reset', now + options.windowMs);

        next();
      } catch (error) {
        next(error);
      }
    };
  }
}

// Export rate limiters
export const generalRateLimit = RateLimitMiddleware.general;
export const authRateLimit = RateLimitMiddleware.auth;
export const loginRateLimit = RateLimitMiddleware.login;
export const registerRateLimit = RateLimitMiddleware.register;
export const passwordResetRateLimit = RateLimitMiddleware.passwordReset;
export const emailVerificationRateLimit = RateLimitMiddleware.emailVerification;
export const smsRateLimit = RateLimitMiddleware.sms;
export const uploadRateLimit = RateLimitMiddleware.upload;
export const createOfferRateLimit = RateLimitMiddleware.createOffer;
export const initiateSwapRateLimit = RateLimitMiddleware.initiateSwap;
export const sendMessageRateLimit = RateLimitMiddleware.sendMessage;
export const apiKeyRateLimit = RateLimitMiddleware.apiKey;

export default RateLimitMiddleware;