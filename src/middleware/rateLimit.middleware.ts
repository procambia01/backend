// src/middleware/rateLimit.middleware.ts
//
// FIX: RedisStore is instantiated at CLASS DEFINITION TIME (static properties),
// which means it runs synchronously during module import — before Redis is ready.
// The `redisClient.getClient()` call here is safe (returns the ioredis instance),
// but rate-limit-redis v4+ requires the client to be in 'ready' state or uses
// a sendCommand interface. If your Redis client isn't ready yet, this can hang.
//
// DEBUG: Added console.log at every static property init to confirm order.

import rateLimit from 'express-rate-limit';
import RedisStore, { SendCommandFn } from 'rate-limit-redis';
import { Request } from 'express';
import redisClient from '@/config/redis';
import { config } from '@/config/env';
import { TooManyRequestsError } from '@/utils/error.util';

console.log('[RATE-LIMIT] rateLimit.middleware.ts loading...');
console.log('[RATE-LIMIT] getting Redis client instance for rate limiters...');

const client = redisClient.getClient();
console.log('[RATE-LIMIT] Redis client status:', client.status);

// Typed sendCommand helper — cast to SendCommandFn to satisfy rate-limit-redis types
const sendCommand: SendCommandFn = (...args: [string, ...string[]]) =>
  (client as any).call(...args) as Promise<any>;

export class RateLimitMiddleware {
  static general = (() => {
    return rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.maxRequests,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:general:',
      }),
      handler: () => {
        throw new TooManyRequestsError('Too many requests, please try again later');
      },
      skip: (req: Request) => req.user?.role === 'SUPER_ADMIN',
    });
  })();

  static auth = (() => {
    return rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:auth:',
      }),
      handler: () => {
        throw new TooManyRequestsError('Too many authentication attempts, please try again later');
      },
    });
  })();

  static login = (() => {
    return rateLimit({
      windowMs: 15 * 60 * 1000,
      max: config.isDevelopment ? 1000 : 10,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:login:',
      }),
      handler: () => {
        throw new TooManyRequestsError('Too many login attempts, please try again later');
      },
      keyGenerator: (req: Request) => req.body.email || req.ip || 'unknown',
    });
  })();

  static register = (() => {
    return rateLimit({
      windowMs: 60 * 60 * 1000,
      max: config.isDevelopment ? 100 : 5, // relaxed in dev for testing
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:register:',
      }),
      handler: () => {
        throw new TooManyRequestsError('Too many registration attempts, please try again later');
      },
      skip: () => config.isDevelopment, // skip entirely in development
    });
  })();

  static passwordReset = (() => {
    return rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 3,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:password-reset:',
      }),
      handler: () => {
        throw new TooManyRequestsError('Too many password reset attempts, please try again later');
      },
      keyGenerator: (req: Request) => req.body.email || req.ip || 'unknown',
    });
  })();

  static emailVerification = (() => {
    return rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 3,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:email-verify:',
      }),
      handler: () => {
        throw new TooManyRequestsError('Too many verification attempts, please try again later');
      },
    });
  })();

  static sms = (() => {
    return rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:sms:',
      }),
      handler: () => {
        throw new TooManyRequestsError('Too many SMS requests, please try again later');
      },
    });
  })();

  static upload = (() => {
    return rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:upload:',
      }),
      handler: () => {
        throw new TooManyRequestsError('Too many upload attempts, please try again later');
      },
      skip: (req: Request) =>
        req.user?.role === 'PREMIUM' ||
        req.user?.role === 'ADMIN' ||
        req.user?.role === 'SUPER_ADMIN',
    });
  })();

  static createOffer = (() => {
    return rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 10,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:create-offer:',
      }),
      handler: () => {
        throw new TooManyRequestsError('Too many offers created, please try again later');
      },
      keyGenerator: (req: Request) => req.user?.userId || req.ip || 'unknown',
      skip: (req: Request) => req.user?.role === 'PREMIUM' || req.user?.role === 'BUSINESS',
    });
  })();

  static initiateSwap = (() => {
    return rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:initiate-swap:',
      }),
      handler: () => {
        throw new TooManyRequestsError('Too many swap requests, please try again later');
      },
      keyGenerator: (req: Request) => req.user?.userId || req.ip || 'unknown',
    });
  })();

  static sendMessage = (() => {
    return rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:send-message:',
      }),
      handler: () => {
        throw new TooManyRequestsError('Too many messages sent, please slow down');
      },
      keyGenerator: (req: Request) => req.user?.userId || req.ip || 'unknown',
    });
  })();

  static apiKey = (() => {
    return rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 10000,
      standardHeaders: true,
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand,
        prefix: 'rl:api-key:',
      }),
      handler: () => {
        throw new TooManyRequestsError('API rate limit exceeded');
      },
      keyGenerator: (req: Request) => (req.headers['x-api-key'] as string) || req.ip || 'unknown',
    });
  })();
}

console.log('[RATE-LIMIT] All rate limiters created ✅');

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
