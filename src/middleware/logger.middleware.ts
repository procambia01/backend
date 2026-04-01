import { Request, Response, NextFunction } from 'express';
import morgan from 'morgan';
import logger, { morganStream } from '@/utils/logger.util';
import { config } from '@/config/env';

export class LoggerMiddleware {
  /**
   * Morgan HTTP request logger
   */
  static http = morgan(
    ':method :url :status :res[content-length] - :response-time ms',
    { stream: morganStream }
  );

  /**
   * Morgan with custom format
   */
  static custom = morgan(
    (tokens, req, res) => {
      return JSON.stringify({
        method: tokens.method(req, res),
        url: tokens.url(req, res),
        status: tokens.status(req, res),
        contentLength: tokens.res(req, res, 'content-length'),
        responseTime: `${tokens['response-time'](req, res)}ms`,
        remoteAddr: tokens['remote-addr'](req, res),
        userAgent: tokens['user-agent'](req, res),
        userId: (req as any).user?.userId,
      });
    },
    { stream: morganStream }
  );

  /**
   * Request logger with details
   */
  static logRequest(req: Request, _res: Response, next: NextFunction): void {
    const start = Date.now();

    _res.on('finish', () => {
      const duration = Date.now() - start;
      const logData = {
        method: req.method,
        url: req.originalUrl,
        status: _res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
        userId: req.user?.userId,
        userAgent: req.get('user-agent'),
      };

      if (_res.statusCode >= 500) {
        logger.error('Request error', logData);
      } else if (_res.statusCode >= 400) {
        logger.warn('Request warning', logData);
      } else {
        logger.http('Request completed', logData);
      }
    });

    next();
  }

  /**
   * Log request body (be careful with sensitive data)
   */
  static logBody(req: Request, _res: Response, next: NextFunction): void {
    if (config.isDevelopment && req.body && Object.keys(req.body).length > 0) {
      // Sanitize sensitive fields
      const sanitizedBody = { ...req.body };
      const sensitiveFields = ['password', 'passwordConfirm', 'token', 'refreshToken'];
      
      sensitiveFields.forEach(field => {
        if (sanitizedBody[field]) {
          sanitizedBody[field] = '***REDACTED***';
        }
      });

      logger.debug('Request body', {
        method: req.method,
        url: req.originalUrl,
        body: sanitizedBody,
      });
    }

    next();
  }

  /**
   * Log query parameters
   */
  static logQuery(req: Request, _res: Response, next: NextFunction): void {
    if (config.isDevelopment && req.query && Object.keys(req.query).length > 0) {
      logger.debug('Query parameters', {
        method: req.method,
        url: req.originalUrl,
        query: req.query,
      });
    }

    next();
  }

  /**
   * Log headers (excluding sensitive ones)
   */
  static logHeaders(req: Request, _res: Response, next: NextFunction): void {
    if (config.isDevelopment) {
      const headers = { ...req.headers };
      
      // Remove sensitive headers
      delete headers.authorization;
      delete headers.cookie;
      delete headers['x-api-key'];

      logger.debug('Request headers', {
        method: req.method,
        url: req.originalUrl,
        headers,
      });
    }

    next();
  }

  /**
   * Log user actions (for audit trail)
   */
  static logUserAction(action: string) {
    return (req: Request, _res: Response, next: NextFunction): void => {
      if (req.user) {
        logger.info('User action', {
          userId: req.user.userId,
          email: req.user.email,
          role: req.user.role,
          action,
          method: req.method,
          url: req.originalUrl,
          ip: req.ip,
        });
      }
      next();
    };
  }

  /**
   * Log admin actions (for audit trail)
   */
  static logAdminAction(action: string) {
    return (req: Request, _res: Response, next: NextFunction): void => {
      if (req.user && (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN')) {
        logger.warn('Admin action', {
          adminId: req.user.userId,
          email: req.user.email,
          role: req.user.role,
          action,
          method: req.method,
          url: req.originalUrl,
          body: req.body,
          params: req.params,
          ip: req.ip,
        });
      }
      next();
    };
  }

  /**
   * Log slow requests
   */
  static logSlowRequests(thresholdMs: number = 1000) {
    return (req: Request, _res: Response, next: NextFunction): void => {
      const start = Date.now();

      _res.on('finish', () => {
        const duration = Date.now() - start;
        
        if (duration > thresholdMs) {
          logger.warn('Slow request detected', {
            method: req.method,
            url: req.originalUrl,
            duration: `${duration}ms`,
            userId: req.user?.userId,
            status: _res.statusCode,
          });
        }
      });

      next();
    };
  }

  /**
   * Log errors
   */
  static logError(err: Error, req: Request, _res: Response, next: NextFunction): void {
    logger.error('Error occurred', {
      error: err.message,
      stack: err.stack,
      method: req.method,
      url: req.originalUrl,
      userId: req.user?.userId,
      ip: req.ip,
    });

    next(err);
  }

  /**
   * Skip logging for specific routes
   */
  static skipRoutes(routes: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (routes.some(route => req.originalUrl.startsWith(route))) {
        return next();
      }
      
      LoggerMiddleware.logRequest(req, res, next);
    };
  }

  /**
   * Log only specific routes
   */
  static onlyRoutes(routes: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!routes.some(route => req.originalUrl.startsWith(route))) {
        return next();
      }
      
      LoggerMiddleware.logRequest(req, res, next);
    };
  }
}

// Export logger middleware
export const httpLogger = LoggerMiddleware.http;
export const customLogger = LoggerMiddleware.custom;
export const logRequest = LoggerMiddleware.logRequest;
export const logBody = LoggerMiddleware.logBody;
export const logQuery = LoggerMiddleware.logQuery;
export const logHeaders = LoggerMiddleware.logHeaders;
export const logUserAction = LoggerMiddleware.logUserAction;
export const logAdminAction = LoggerMiddleware.logAdminAction;
export const logSlowRequests = LoggerMiddleware.logSlowRequests;
export const logError = LoggerMiddleware.logError;

export default LoggerMiddleware;