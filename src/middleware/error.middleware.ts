import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '@/utils/error.util';
import ResponseUtil from '@/utils/response.util';
import logger from '@/utils/logger.util';
import { config } from '@/config/env';

function prismaToApi(error: Prisma.PrismaClientKnownRequestError): { status: number; code: string; message: string } {
  switch (error.code) {
    case 'P2002':
      return { status: 409, code: 'CONFLICT', message: 'This record already exists' };
    case 'P2025':
      return { status: 404, code: 'NOT_FOUND', message: 'Record not found' };
    case 'P2023':
      return { status: 400, code: 'BAD_REQUEST', message: 'Invalid identifier' };
    default:
      return { status: 500, code: 'INTERNAL_ERROR', message: 'Database error' };
  }
}

export class ErrorMiddleware {
  static handle(error: Error, req: Request, res: Response, _next: NextFunction): void {
    const send = (status: number, code: string, message: string, details?: unknown) => {
      res.locals.errorCode = code;
      ResponseUtil.error(res, status, code, message, details);
    };

    if (error instanceof AppError) {
      if (error.statusCode >= 500) logger.error('app error', { code: error.code, message: error.message, stack: error.stack });
      return send(error.statusCode, error.code, error.message, error.details);
    }
    if (error instanceof ZodError) {
      return send(
        422,
        'VALIDATION_ERROR',
        'Validation failed',
        error.errors.map((e) => ({ field: e.path.join('.'), message: e.message }))
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = prismaToApi(error);
      if (mapped.status >= 500) logger.error('prisma error', { code: error.code, message: error.message });
      return send(mapped.status, mapped.code, mapped.message);
    }
    if (error instanceof Prisma.PrismaClientValidationError) {
      logger.warn('prisma validation error', { message: error.message.slice(0, 300) });
      return send(400, 'BAD_REQUEST', 'Invalid data provided');
    }
    if (error.message?.includes('Malformed ObjectID') || error.message?.includes('Inconsistent column data')) {
      return send(400, 'BAD_REQUEST', 'Invalid identifier');
    }
    if (error.name === 'MulterError') {
      return send(400, 'UPLOAD_INVALID', error.message);
    }
    if ((error as { type?: string }).type === 'entity.too.large') {
      return send(413, 'BAD_REQUEST', 'Request body too large');
    }
    if ((error as { type?: string }).type === 'entity.parse.failed') {
      return send(400, 'BAD_REQUEST', 'Malformed JSON body');
    }

    logger.error('unhandled error', { message: error.message, stack: config.isProduction ? undefined : error.stack, path: req.path });
    return send(500, 'INTERNAL_ERROR', config.isProduction ? 'Internal server error' : error.message);
  }

  static notFound(req: Request, res: Response, _next: NextFunction): void {
    res.locals.errorCode = 'NOT_FOUND';
    ResponseUtil.error(res, 404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`);
  }

  static asyncHandler<T extends Request = Request>(fn: (req: T, res: Response, next: NextFunction) => unknown) {
    return (req: T, res: Response, next: NextFunction): void => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }
}

export const errorHandler = ErrorMiddleware.handle;
export const notFound = ErrorMiddleware.notFound;
export const asyncHandler = ErrorMiddleware.asyncHandler;
export default ErrorMiddleware;
