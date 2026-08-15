// src/middleware/rateLimit.middleware.ts
import rateLimit, { Store, IncrementResponse } from 'express-rate-limit';
import RedisStore, { SendCommandFn } from 'rate-limit-redis';
import { Request } from 'express';
import redisClient from '@/config/redis';
import { config } from '@/config/env';
import { TooManyRequestsError } from '@/utils/error.util';
import logger from '@/utils/logger.util';

const client = redisClient.getClient();

const sendCommand: SendCommandFn = (...args: [string, ...string[]]) =>
  (client as any).call(...args) as Promise<any>;

/**
 * Wraps RedisStore so that a Redis outage degrades rate limiting instead of
 * crashing the server. Rate limiting is a protective feature, not core
 * functionality — every request going through express-rate-limit calls
 * increment() on the store, so a rejected promise here (Redis unreachable,
 * DNS failure, connection reset, etc.) becomes an unhandled rejection on
 * every single incoming request, which previously took the whole process
 * down via the app's global unhandledRejection handler.
 *
 * This wrapper fails OPEN: if Redis can't be reached, requests are allowed
 * through rather than blocked, and the failure is logged (throttled to
 * avoid flooding logs) rather than thrown.
 */
class ResilientRedisStore implements Store {
  private inner: RedisStore;
  private lastWarnAt = 0;

  constructor(prefix: string) {
    this.inner = new RedisStore({ sendCommand, prefix });
  }

  private warnOnce(context: string, error: unknown) {
    const now = Date.now();
    if (now - this.lastWarnAt > 30_000) {
      this.lastWarnAt = now;
      logger.warn(
        `[RateLimit] Redis unavailable in ${context}, failing open (requests allowed): ${(error as Error)?.message ?? error}`
      );
    }
  }

  private isRedisReady(): boolean {
    return client.status === 'ready';
  }

  async increment(key: string): Promise<IncrementResponse> {
    if (!this.isRedisReady()) {
      this.warnOnce('increment', new Error(`Redis client status: ${client.status}`));
      return { totalHits: 1, resetTime: undefined };
    }
    try {
      return await this.inner.increment(key);
    } catch (error) {
      this.warnOnce('increment', error);
      return { totalHits: 1, resetTime: undefined };
    }
  }

  async decrement(key: string): Promise<void> {
    if (!this.isRedisReady()) return;
    try {
      await this.inner.decrement(key);
    } catch (error) {
      this.warnOnce('decrement', error);
    }
  }

  async resetKey(key: string): Promise<void> {
    if (!this.isRedisReady()) return;
    try {
      await this.inner.resetKey(key);
    } catch (error) {
      this.warnOnce('resetKey', error);
    }
  }
}

export class RateLimitMiddleware {
  static general = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:general:'),
    handler: () => {
      throw new TooManyRequestsError('Too many requests, please try again later');
    },
    skip: (req: Request) => req.user?.role === 'SUPER_ADMIN',
  });

  static auth = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:auth:'),
    handler: () => {
      throw new TooManyRequestsError('Too many authentication attempts, please try again later');
    },
  });

  static login = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: config.isDevelopment ? 1000 : 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:login:'),
    handler: () => {
      throw new TooManyRequestsError('Too many login attempts, please try again later');
    },
    keyGenerator: (req: Request) => req.body.email || req.ip || 'unknown',
  });

  static register = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: config.isDevelopment ? 100 : 5, // relaxed in dev for testing
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:register:'),
    handler: () => {
      throw new TooManyRequestsError('Too many registration attempts, please try again later');
    },
    skip: () => config.isDevelopment, // skip entirely in development
  });

  static passwordReset = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:password-reset:'),
    handler: () => {
      throw new TooManyRequestsError('Too many password reset attempts, please try again later');
    },
    keyGenerator: (req: Request) => req.body.email || req.ip || 'unknown',
  });

  static emailVerification = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:email-verify:'),
    handler: () => {
      throw new TooManyRequestsError('Too many verification attempts, please try again later');
    },
  });

  static sms = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:sms:'),
    handler: () => {
      throw new TooManyRequestsError('Too many SMS requests, please try again later');
    },
  });

  static upload = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:upload:'),
    handler: () => {
      throw new TooManyRequestsError('Too many upload attempts, please try again later');
    },
    skip: (req: Request) =>
      req.user?.role === 'PREMIUM' ||
      req.user?.role === 'ADMIN' ||
      req.user?.role === 'SUPER_ADMIN',
  });

  static createOffer = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:create-offer:'),
    handler: () => {
      throw new TooManyRequestsError('Too many offers created, please try again later');
    },
    keyGenerator: (req: Request) => req.user?.userId || req.ip || 'unknown',
    skip: (req: Request) => req.user?.role === 'PREMIUM' || req.user?.role === 'BUSINESS',
  });

  static initiateSwap = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:initiate-swap:'),
    handler: () => {
      throw new TooManyRequestsError('Too many swap requests, please try again later');
    },
    keyGenerator: (req: Request) => req.user?.userId || req.ip || 'unknown',
  });

  static sendMessage = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:send-message:'),
    handler: () => {
      throw new TooManyRequestsError('Too many messages sent, please slow down');
    },
    keyGenerator: (req: Request) => req.user?.userId || req.ip || 'unknown',
  });

  static apiKey = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10000,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore('rl:api-key:'),
    handler: () => {
      throw new TooManyRequestsError('API rate limit exceeded');
    },
    keyGenerator: (req: Request) => (req.headers['x-api-key'] as string) || req.ip || 'unknown',
  });
}

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
