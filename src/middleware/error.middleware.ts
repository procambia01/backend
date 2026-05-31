import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { config } from '@/config/env';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class ErrorMiddleware {
  /**
   * Global error handler
   * FIX: was using `this.handlePrismaError` and `this.handleMulterError` inside
   * a static method — `this` is undefined when the function is exported as a
   * standalone reference (errorHandler = ErrorMiddleware.handle). Changed all
   * internal calls to use the class name directly: ErrorMiddleware.handlePrismaError
   */
  static handle(error: Error | AppError, req: Request, res: Response, next: NextFunction): void {
    // Log error
    logger.error('Error occurred:', {
      message: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userId: req.user?.userId,
    });

    // Handle AppError
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        message: error.message,
        errors: error.errors,
        ...(config.isDevelopment && { stack: error.stack }),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Handle Prisma known errors (e.g. unique constraint, not found)
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaError = ErrorMiddleware.handlePrismaError(error);
      res.status(prismaError.statusCode).json({
        success: false,
        message: prismaError.message,
        ...(config.isDevelopment && { stack: error.stack }),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Handle Prisma validation errors (malformed ObjectID, bad query shape etc.)
    if (error instanceof Prisma.PrismaClientValidationError) {
      res.status(400).json({
        success: false,
        message: 'Invalid data provided',
        ...(config.isDevelopment && { details: error.message, stack: error.stack }),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Handle raw Prisma engine errors (e.g. malformed ObjectID from inconsistent column data)
    if (
      error.constructor?.name === 'PrismaClientUnknownRequestError' ||
      error.message?.includes('Malformed ObjectID') ||
      error.message?.includes('Inconsistent column data')
    ) {
      res.status(400).json({
        success: false,
        message: 'Invalid ID format',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Handle Zod validation errors
    if (error instanceof ZodError) {
      const errors = error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      res.status(422).json({
        success: false,
        message: 'Validation failed',
        errors,
        ...(config.isDevelopment && { stack: error.stack }),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Handle JWT errors
    if (error.name === 'JsonWebTokenError') {
      res.status(401).json({
        success: false,
        message: 'Invalid token',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (error.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        message: 'Token expired',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Handle Multer errors
    if (error.name === 'MulterError') {
      const multerError = ErrorMiddleware.handleMulterError(error);
      res.status(multerError.statusCode).json({
        success: false,
        message: multerError.message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Generic fallback
    const statusCode = 500;
    const message = config.isProduction
      ? 'Internal server error'
      : error.message || 'Something went wrong';

    res.status(statusCode).json({
      success: false,
      message,
      ...(config.isDevelopment && { stack: error.stack }),
      timestamp: new Date().toISOString(),
    });
  }

  private static handlePrismaError(error: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    message: string;
  } {
    switch (error.code) {
      case 'P2002': {
        // MongoDB Prisma returns meta.target as a string (e.g. "User_phone_key")
        // PostgreSQL returns it as an array (e.g. ["email"]). Handle both.
        const raw = error.meta?.target;
        let field = 'field';
        if (Array.isArray(raw)) {
          field = raw.join(', ');
        } else if (typeof raw === 'string') {
          // Extract field from constraint name: "User_phone_key" → "phone"
          // Pattern: ModelName_fieldName_key
          const match = raw.match(/^[A-Z][a-zA-Z]+_(.+?)_key$/);
          field = match ? match[1] : raw;
        }
        // Map internal field names to user-friendly labels
        const labels: Record<string, string> = {
          email: 'Email address',
          phone: 'Phone number',
          name: 'Name',
        };
        const label = labels[field] ?? field;
        return { statusCode: 409, message: `${label} is already in use` };
      }
      case 'P2025':
        return { statusCode: 404, message: 'Record not found' };
      case 'P2003':
        return { statusCode: 400, message: 'Invalid reference to related record' };
      case 'P2011':
        return { statusCode: 400, message: 'Required field cannot be null' };
      case 'P2014':
        return { statusCode: 400, message: 'Invalid relation' };
      case 'P2016':
        return { statusCode: 400, message: 'Invalid query parameters' };
      case 'P2021':
        return { statusCode: 500, message: 'Database table does not exist' };
      case 'P2022':
        return { statusCode: 500, message: 'Database column does not exist' };
      default:
        return {
          statusCode: 500,
          message: config.isProduction ? 'Database error' : error.message,
        };
    }
  }

  private static handleMulterError(error: any): {
    statusCode: number;
    message: string;
  } {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return { statusCode: 400, message: 'File size too large' };
      case 'LIMIT_FILE_COUNT':
        return { statusCode: 400, message: 'Too many files' };
      case 'LIMIT_UNEXPECTED_FILE':
        return { statusCode: 400, message: 'Unexpected file field' };
      default:
        return { statusCode: 400, message: 'File upload error' };
    }
  }

  static notFound(req: Request, res: Response, _next: NextFunction): void {
    res.status(404).json({
      success: false,
      message: `Route ${req.method} ${req.path} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  static asyncHandler(fn: Function) {
    return (req: Request, res: Response, next: NextFunction): void => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }
}

// Bound exports so `this` context is preserved when used as Express middleware
export const errorHandler = ErrorMiddleware.handle.bind(ErrorMiddleware);
export const notFound = ErrorMiddleware.notFound.bind(ErrorMiddleware);
export const asyncHandler = ErrorMiddleware.asyncHandler.bind(ErrorMiddleware);

export default ErrorMiddleware;
