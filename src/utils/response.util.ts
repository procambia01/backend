// src/utils/response.util.ts
import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  errors?: any[];
  meta?: {
    page?: number;
    perPage?: number;
    total?: number;
    totalPages?: number;
    hasMore?: boolean;
  };
  timestamp: string;
}

export class ResponseUtil {
  /**
   * Send success response
   */
  static success<T>(
    res: Response,
    data?: T,
    message: string = 'Success',
    statusCode: number = 200
  ): Response {
    const response: ApiResponse<T> = {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    return res.status(statusCode).json(response);
  }

  /**
   * Send error response
   */
  static error(
    res: Response,
    message: string = 'Error',
    statusCode: number = 500,
    errors?: any[]
  ): Response {
    const response: ApiResponse = {
      success: false,
      message,
      errors,
      timestamp: new Date().toISOString(),
    };

    return res.status(statusCode).json(response);
  }

  /**
   * Send paginated response
   */
  static paginated<T>(
    res: Response,
    data: T[],
    page: number,
    perPage: number,
    total: number,
    message: string = 'Success'
  ): Response {
    const totalPages = Math.ceil(total / perPage);
    const hasMore = page < totalPages;

    const response: ApiResponse<T[]> = {
      success: true,
      message,
      data,
      meta: {
        page,
        perPage,
        total,
        totalPages,
        hasMore,
      },
      timestamp: new Date().toISOString(),
    };

    // Set pagination headers
    res.setHeader('X-Total-Count', total);
    res.setHeader('X-Page', page);
    res.setHeader('X-Per-Page', perPage);
    res.setHeader('X-Total-Pages', totalPages);

    return res.status(200).json(response);
  }

  /**
   * Send created response (201)
   */
  static created<T>(
    res: Response,
    data: T,
    message: string = 'Resource created successfully'
  ): Response {
    return this.success(res, data, message, 201);
  }

  /**
   * Send no content response (204)
   */
  static noContent(res: Response): Response {
    return res.status(204).send();
  }

  /**
   * Send bad request response (400)
   */
  static badRequest(
    res: Response,
    message: string = 'Bad request',
    errors?: any[]
  ): Response {
    return this.error(res, message, 400, errors);
  }

  /**
   * Send unauthorized response (401)
   */
  static unauthorized(
    res: Response,
    message: string = 'Unauthorized'
  ): Response {
    return this.error(res, message, 401);
  }

  /**
   * Send forbidden response (403)
   */
  static forbidden(
    res: Response,
    message: string = 'Forbidden'
  ): Response {
    return this.error(res, message, 403);
  }

  /**
   * Send not found response (404)
   */
  static notFound(
    res: Response,
    message: string = 'Resource not found'
  ): Response {
    return this.error(res, message, 404);
  }

  /**
   * Send conflict response (409)
   */
  static conflict(
    res: Response,
    message: string = 'Conflict'
  ): Response {
    return this.error(res, message, 409);
  }

  /**
   * Send validation error response (422)
   */
  static validationError(
    res: Response,
    errors: any[],
    message: string = 'Validation failed'
  ): Response {
    return this.error(res, message, 422, errors);
  }

  /**
   * Send too many requests response (429)
   */
  static tooManyRequests(
    res: Response,
    message: string = 'Too many requests'
  ): Response {
    return this.error(res, message, 429);
  }

  /**
   * Send internal server error response (500)
   */
  static internalError(
    res: Response,
    message: string = 'Internal server error'
  ): Response {
    return this.error(res, message, 500);
  }

  /**
   * Send service unavailable response (503)
   */
  static serviceUnavailable(
    res: Response,
    message: string = 'Service unavailable'
  ): Response {
    return this.error(res, message, 503);
  }
}

export default ResponseUtil;