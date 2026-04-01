import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { config } from '@/config/env';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export class ErrorMiddleware {
  /**
   * Global error handler
   */
  static handle(
    error: Error | AppError,
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
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

    // Handle Prisma errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const prismaError = this.handlePrismaError(error);
      res.status(prismaError.statusCode).json({
        success: false,
        message: prismaError.message,
        ...(config.isDevelopment && { stack: error.stack }),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Handle Prisma validation errors
    if (error instanceof Prisma.PrismaClientValidationError) {
      res.status(400).json({
        success: false,
        message: 'Invalid data provided',
        ...(config.isDevelopment && { details: error.message, stack: error.stack }),
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
      const multerError = this.handleMulterError(error);
      res.status(multerError.statusCode).json({
        success: false,
        message: multerError.message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Handle generic errors
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

  /**
   * Handle Prisma errors
   */
  private static handlePrismaError(error: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    message: string;
  } {
    switch (error.code) {
      case 'P2002':
        // Unique constraint violation
        const field = (error.meta?.target as string[])?.join(', ') || 'field';
        return {
          statusCode: 409,
          message: `${field} already exists`,
        };

      case 'P2025':
        // Record not found
        return {
          statusCode: 404,
          message: 'Record not found',
        };

      case 'P2003':
        // Foreign key constraint failed
        return {
          statusCode: 400,
          message: 'Invalid reference to related record',
        };

      case 'P2011':
        // Null constraint violation
        return {
          statusCode: 400,
          message: 'Required field cannot be null',
        };

      case 'P2014':
        // Relation violation
        return {
          statusCode: 400,
          message: 'Invalid relation',
        };

      case 'P2016':
        // Query interpretation error
        return {
          statusCode: 400,
          message: 'Invalid query parameters',
        };

      case 'P2021':
        // Table does not exist
        return {
          statusCode: 500,
          message: 'Database table does not exist',
        };

      case 'P2022':
        // Column does not exist
        return {
          statusCode: 500,
          message: 'Database column does not exist',
        };

      default:
        return {
          statusCode: 500,
          message: config.isProduction
            ? 'Database error'
            : error.message,
        };
    }
  }

  /**
   * Handle Multer errors
   */
  private static handleMulterError(error: any): {
    statusCode: number;
    message: string;
  } {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        return {
          statusCode: 400,
          message: 'File size too large',
        };

      case 'LIMIT_FILE_COUNT':
        return {
          statusCode: 400,
          message: 'Too many files',
        };

      case 'LIMIT_UNEXPECTED_FILE':
        return {
          statusCode: 400,
          message: 'Unexpected file field',
        };

      default:
        return {
          statusCode: 400,
          message: 'File upload error',
        };
    }
  }

  /**
   * Handle 404 not found
   */
  static notFound(req: Request, res: Response, next: NextFunction): void {
    res.status(404).json({
      success: false,
      message: `Route ${req.method} ${req.path} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Async error wrapper
   */
  static asyncHandler(fn: Function) {
    return (req: Request, res: Response, next: NextFunction): void => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }
}

// Export middleware functions
export const errorHandler = ErrorMiddleware.handle;
export const notFound = ErrorMiddleware.notFound;
export const asyncHandler = ErrorMiddleware.asyncHandler;

export default ErrorMiddleware;