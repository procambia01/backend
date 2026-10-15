import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '@/utils/logger.util';
import { requestContext } from '@/lib/request-context';

/**
 * Assigns a request id (honouring a sane inbound X-Request-Id), stores it in
 * AsyncLocalStorage so every log line carries it, and writes one structured
 * access-log line per request: route, status, latency, error code, user id.
 * Bodies, headers and query strings are never logged.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get('x-request-id');
  const requestId = inbound && /^[A-Za-z0-9_-]{8,64}$/.test(inbound) ? inbound : crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  const start = process.hrtime.bigint();
  const ctx = { requestId, ip: req.ip, userAgent: req.get('user-agent') ?? undefined };

  res.on('finish', () => {
    const latencyMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || req.path;
    if (route === '/health' || route === '/ready') return;
    const entry = {
      requestId,
      method: req.method,
      route,
      status: res.statusCode,
      latencyMs,
      userId: req.user?.userId,
      errorCode: (res.locals.errorCode as string | undefined) ?? undefined,
    };
    if (res.statusCode >= 500) logger.error('request', entry);
    else if (res.statusCode >= 400) logger.warn('request', entry);
    else logger.http('request', entry);
  });

  requestContext.run(ctx, next);
}

/** Call after authentication so subsequent logs carry the user id. */
export function bindUserToContext(userId: string): void {
  const store = requestContext.getStore();
  if (store) store.userId = userId;
}

export default requestLogger;
