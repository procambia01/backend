// src/middleware/rateLimit.middleware.ts
import rateLimit, { Store, IncrementResponse } from 'express-rate-limit';
import RedisStore, { SendCommandFn } from 'rate-limit-redis';
import { Request } from 'express';
import redisClient from '@/config/redis';
import { config } from '@/config/env';
import { TooManyRequestsError } from '@/utils/error.util';
import type { Request as ExpressRequest } from 'express';
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
    // The store eagerly loads its Lua scripts; if Redis is down at boot those promises reject with nobody
    // awaiting them. They are retried on first use, so just stop them surfacing as unhandled rejections.
    const loaded = this.inner as unknown as { incrementScriptSha?: Promise<unknown>; getScriptSha?: Promise<unknown> };
    loaded.incrementScriptSha?.catch(() => undefined);
    loaded.getScriptSha?.catch(() => undefined);
  }

  /** express-rate-limit hands the window length to the store here; without forwarding it the Redis
   *  script would receive `undefined` as its TTL and every increment would fail (and fail open). */
  init(options: Parameters<NonNullable<Store['init']>>[0]): void {
    this.inner.init(options);
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


type KeyFn = (req: Request) => string;

const byUserOrIp: KeyFn = (req) => req.user?.userId ?? req.ip ?? 'unknown';
const byIp: KeyFn = (req) => req.ip ?? 'unknown';
const byEmailAndIp: KeyFn = (req) => `${String(req.body?.email ?? '').toLowerCase()}|${req.ip ?? ''}`;

interface LimiterOpts {
  prefix: string;
  windowMs: number;
  max: number | ((req: Request) => number);
  message: string;
  key?: KeyFn;
}

/** Throws via `next` so the standard error envelope (code RATE_LIMITED) is returned. */
function limiter(o: LimiterOpts) {
  return rateLimit({
    windowMs: o.windowMs,
    limit: typeof o.max === 'function' ? (o.max as (req: ExpressRequest) => number) : o.max,
    standardHeaders: true,
    legacyHeaders: false,
    store: new ResilientRedisStore(`rl:${o.prefix}:`),
    keyGenerator: (req) => (o.key ?? byIp)(req as Request),
    skip: () => config.isTest,
    handler: (_req, _res, next) => next(new TooManyRequestsError(o.message)),
  });
}

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Plan-aware multiplier: paid plans get more headroom, but nobody is unlimited. */
const planFactor = (req: Request) => (req.user?.planTier === 'BUSINESS' ? 4 : req.user?.planTier === 'PREMIUM' ? 2 : 1);

export class RateLimitMiddleware {
  static general = limiter({
    prefix: 'general',
    windowMs: config.rateLimit.windowMs,
    max: (req) => config.rateLimit.maxRequests * planFactor(req),
    message: 'Too many requests, please try again later',
    key: byUserOrIp,
  });

  /** Credential stuffing: per email+IP, tight. */
  static login = limiter({ prefix: 'login', windowMs: 15 * MIN, max: 10, message: 'Too many login attempts, please try again later', key: byEmailAndIp });
  static loginByIp = limiter({ prefix: 'login-ip', windowMs: 15 * MIN, max: 50, message: 'Too many login attempts, please try again later' });
  static register = limiter({ prefix: 'register', windowMs: HOUR, max: 10, message: 'Too many registration attempts, please try again later' });
  static refresh = limiter({ prefix: 'refresh', windowMs: 15 * MIN, max: 60, message: 'Too many token refresh attempts' });
  static passwordReset = limiter({ prefix: 'pwreset', windowMs: 15 * MIN, max: 5, message: 'Too many password reset attempts, please try again later', key: byEmailAndIp });
  static emailVerification = limiter({ prefix: 'emailverify', windowMs: 15 * MIN, max: 5, message: 'Too many verification attempts, please try again later', key: byUserOrIp });
  static reauth = limiter({ prefix: 'reauth', windowMs: 15 * MIN, max: 10, message: 'Too many re-authentication attempts', key: byUserOrIp });
  static otpRequest = limiter({ prefix: 'otp-req', windowMs: HOUR, max: 5, message: 'Too many verification codes requested', key: byUserOrIp });
  static otpVerify = limiter({ prefix: 'otp-verify', windowMs: 15 * MIN, max: 10, message: 'Too many verification attempts', key: byUserOrIp });
  static twoFactor = limiter({ prefix: '2fa', windowMs: 15 * MIN, max: 10, message: 'Too many two-factor attempts', key: byUserOrIp });
  static upload = limiter({ prefix: 'upload', windowMs: HOUR, max: (req) => 20 * planFactor(req), message: 'Too many uploads, please try again later', key: byUserOrIp });
  static createOffer = limiter({ prefix: 'create-offer', windowMs: HOUR, max: (req) => 10 * planFactor(req), message: 'Too many offers created, please try again later', key: byUserOrIp });
  static initiateSwap = limiter({ prefix: 'swap-init', windowMs: HOUR, max: (req) => 20 * planFactor(req), message: 'Too many swap requests, please try again later', key: byUserOrIp });
  static sendMessage = limiter({ prefix: 'message', windowMs: MIN, max: 30, message: 'You are sending messages too quickly', key: byUserOrIp });
  static checkout = limiter({ prefix: 'checkout', windowMs: 10 * MIN, max: 15, message: 'Too many checkout attempts', key: byUserOrIp });
  static report = limiter({ prefix: 'report', windowMs: HOUR, max: 20, message: 'Too many reports submitted', key: byUserOrIp });
  static publicSearch = limiter({ prefix: 'search', windowMs: MIN, max: 60, message: 'Too many searches, please slow down', key: byUserOrIp });
  static admin = limiter({ prefix: 'admin', windowMs: MIN, max: 120, message: 'Too many admin requests', key: byUserOrIp });

  /** API-key consumers: limit is the key's own configured limit per minute. */
  static apiKey = limiter({
    prefix: 'apikey',
    windowMs: MIN,
    max: (req) => req.apiKey?.rateLimitPerMinute ?? 30,
    message: 'API rate limit exceeded',
    key: (req) => req.apiKey?.id ?? req.ip ?? 'unknown',
  });
}

export default RateLimitMiddleware;
