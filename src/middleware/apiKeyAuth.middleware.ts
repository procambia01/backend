import { Request, Response, NextFunction } from 'express';
import { prisma } from '@/config/database';
import { hashApiKey } from '@/utils/apiKey.util';
import { UnauthorizedError, TooManyRequestsError } from '@/utils/error.util';

declare global {
  namespace Express {
    interface Request {
      apiClient?: {
        userId: string;
        keyId: string;
        scopes: string[];
      };
    }
  }
}

// Simple in-memory sliding-window counter per key, reset every minute.
// Good enough for a first cut; swap for the Redis-backed limiter (see
// rateLimit.middleware.ts) if partner traffic outgrows a single instance.
const windows = new Map<string, { count: number; resetAt: number }>();

/**
 * Authenticates partner (B2B) requests via the `X-API-Key` header instead
 * of a JWT. Attaches req.apiClient on success. Used for /partner/* routes.
 */
export async function apiKeyAuth(req: Request, _res: Response, next: NextFunction) {
  const rawKey = req.headers['x-api-key'] as string | undefined;
  if (!rawKey || !rawKey.startsWith('sfx_')) {
    return next(new UnauthorizedError('Missing or invalid API key'));
  }

  const keyHash = hashApiKey(rawKey);
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });

  if (!apiKey || !apiKey.isActive) {
    return next(new UnauthorizedError('Invalid or revoked API key'));
  }
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return next(new UnauthorizedError('API key has expired'));
  }

  const now = Date.now();
  const windowKey = apiKey.id;
  const existing = windows.get(windowKey);
  if (!existing || existing.resetAt < now) {
    windows.set(windowKey, { count: 1, resetAt: now + 60_000 });
  } else {
    existing.count += 1;
    if (existing.count > apiKey.rateLimitPerMinute) {
      return next(new TooManyRequestsError('API rate limit exceeded for this key'));
    }
  }

  // Fire-and-forget usage tracking — don't block the request on it.
  prisma.apiKey
    .update({
      where: { id: apiKey.id },
      data: { requestCount: { increment: 1 }, lastUsedAt: new Date() },
    })
    .catch(() => {});

  req.apiClient = {
    userId: apiKey.userId,
    keyId: apiKey.id,
    scopes: apiKey.scopes,
  };

  next();
}

export function requireScope(scope: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.apiClient?.scopes.includes(scope)) {
      return next(new UnauthorizedError(`API key missing required scope: ${scope}`));
    }
    next();
  };
}
