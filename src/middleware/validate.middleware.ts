import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ValidationError } from '@/utils/error.util';

export class ValidateMiddleware {
  /**
   * Validate request using Zod schema
   */
  static validate(schema: AnyZodObject) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        await schema.parseAsync({
          body: req.body,
          query: req.query,
          params: req.params,
        });
        next();
      } catch (error) {
        if (error instanceof ZodError) {
          const errors = error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code,
          }));

          next(new ValidationError('Validation failed', errors));
        } else {
          next(error);
        }
      }
    };
  }

  /**
   * Validate request body
   */
  static validateBody(schema: AnyZodObject) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        req.body = await schema.parseAsync(req.body);
        next();
      } catch (error) {
        if (error instanceof ZodError) {
          const errors = error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code,
          }));

          next(new ValidationError('Request body validation failed', errors));
        } else {
          next(error);
        }
      }
    };
  }

  /**
   * Validate query parameters
   */
  static validateQuery(schema: AnyZodObject) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        req.query = await schema.parseAsync(req.query);
        next();
      } catch (error) {
        if (error instanceof ZodError) {
          const errors = error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code,
          }));

          next(new ValidationError('Query parameters validation failed', errors));
        } else {
          next(error);
        }
      }
    };
  }

  /**
   * Validate route parameters
   */
  static validateParams(schema: AnyZodObject) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        req.params = await schema.parseAsync(req.params);
        next();
      } catch (error) {
        if (error instanceof ZodError) {
          const errors = error.errors.map((err) => ({
            field: err.path.join('.'),
            message: err.message,
            code: err.code,
          }));

          next(new ValidationError('Route parameters validation failed', errors));
        } else {
          next(error);
        }
      }
    };
  }

  /**
   * Sanitize request body (remove unknown fields)
   */
  static sanitizeBody(allowedFields: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (req.body && typeof req.body === 'object') {
        const sanitized: any = {};
        
        allowedFields.forEach((field) => {
          if (field in req.body) {
            sanitized[field] = req.body[field];
          }
        });

        req.body = sanitized;
      }

      next();
    };
  }

  /**
   * Trim string fields in request body
   */
  static trimStrings(req: Request, res: Response, next: NextFunction): void {
    if (req.body && typeof req.body === 'object') {
      Object.keys(req.body).forEach((key) => {
        if (typeof req.body[key] === 'string') {
          req.body[key] = req.body[key].trim();
        }
      });
    }

    next();
  }

  /**
   * Convert string booleans to actual booleans
   */
  static parseBooleans(req: Request, res: Response, next: NextFunction): void {
    const parseValue = (value: any): any => {
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'true') return true;
        if (value.toLowerCase() === 'false') return false;
      }
      return value;
    };

    if (req.query && typeof req.query === 'object') {
      Object.keys(req.query).forEach((key) => {
        req.query[key] = parseValue(req.query[key]);
      });
    }

    if (req.body && typeof req.body === 'object') {
      Object.keys(req.body).forEach((key) => {
        req.body[key] = parseValue(req.body[key]);
      });
    }

    next();
  }

  /**
   * Convert string numbers to actual numbers
   */
  static parseNumbers(req: Request, res: Response, next: NextFunction): void {
    const parseValue = (value: any): any => {
      if (typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '') {
        return Number(value);
      }
      return value;
    };

    if (req.query && typeof req.query === 'object') {
      Object.keys(req.query).forEach((key) => {
        req.query[key] = parseValue(req.query[key]);
      });
    }

    next();
  }

  /**
   * Validate ObjectId (MongoDB)
   */
  static validateObjectId(paramName: string = 'id') {
    return (req: Request, res: Response, next: NextFunction): void => {
      const id = req.params[paramName];
      
      // MongoDB ObjectId is 24 hex characters
      const objectIdRegex = /^[0-9a-fA-F]{24}$/;
      
      if (!objectIdRegex.test(id)) {
        next(new ValidationError(`Invalid ${paramName} format`));
        return;
      }

      next();
    };
  }

  /**
   * Validate email format
   */
  static validateEmail(fieldName: string = 'email') {
    return (req: Request, res: Response, next: NextFunction): void => {
      const email = req.body[fieldName];
      
      if (!email) {
        next(new ValidationError(`${fieldName} is required`));
        return;
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      
      if (!emailRegex.test(email)) {
        next(new ValidationError(`Invalid ${fieldName} format`));
        return;
      }

      next();
    };
  }

  /**
   * Validate phone format
   */
  static validatePhone(fieldName: string = 'phone') {
    return (req: Request, res: Response, next: NextFunction): void => {
      const phone = req.body[fieldName];
      
      if (!phone) {
        next(new ValidationError(`${fieldName} is required`));
        return;
      }

      // Remove spaces and dashes
      const cleanPhone = phone.replace(/[\s-]/g, '');
      const phoneRegex = /^\+?[1-9]\d{1,14}$/;
      
      if (!phoneRegex.test(cleanPhone)) {
        next(new ValidationError(`Invalid ${fieldName} format`));
        return;
      }

      // Store cleaned phone
      req.body[fieldName] = cleanPhone;

      next();
    };
  }

  /**
   * Validate date format
   */
  static validateDate(fieldName: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const dateValue = req.body[fieldName];
      
      if (!dateValue) {
        next(new ValidationError(`${fieldName} is required`));
        return;
      }

      const date = new Date(dateValue);
      
      if (isNaN(date.getTime())) {
        next(new ValidationError(`Invalid ${fieldName} format`));
        return;
      }

      next();
    };
  }

  /**
   * Validate array field
   */
  static validateArray(fieldName: string, minLength?: number, maxLength?: number) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const array = req.body[fieldName];
      
      if (!Array.isArray(array)) {
        next(new ValidationError(`${fieldName} must be an array`));
        return;
      }

      if (minLength !== undefined && array.length < minLength) {
        next(new ValidationError(`${fieldName} must contain at least ${minLength} items`));
        return;
      }

      if (maxLength !== undefined && array.length > maxLength) {
        next(new ValidationError(`${fieldName} must contain at most ${maxLength} items`));
        return;
      }

      next();
    };
  }

  /**
   * Validate file upload
   */
  static validateFile(fieldName: string = 'file', required: boolean = true) {
    return (req: Request, res: Response, next: NextFunction): void => {
      const file = req.file;
      
      if (!file && required) {
        next(new ValidationError(`${fieldName} is required`));
        return;
      }

      next();
    };
  }

  /**
   * Combine multiple validators
   */
  static combine(...validators: any[]) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      for (const validator of validators) {
        await new Promise<void>((resolve, reject) => {
          validator(req, res, (error?: any) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
      next();
    };
  }
}

// Export middleware functions
export const validate = ValidateMiddleware.validate;
export const validateBody = ValidateMiddleware.validateBody;
export const validateQuery = ValidateMiddleware.validateQuery;
export const validateParams = ValidateMiddleware.validateParams;
export const sanitizeBody = ValidateMiddleware.sanitizeBody;
export const trimStrings = ValidateMiddleware.trimStrings;
export const parseBooleans = ValidateMiddleware.parseBooleans;
export const parseNumbers = ValidateMiddleware.parseNumbers;
export const validateObjectId = ValidateMiddleware.validateObjectId;
export const validateEmail = ValidateMiddleware.validateEmail;
export const validatePhone = ValidateMiddleware.validatePhone;
export const validateDate = ValidateMiddleware.validateDate;
export const validateArray = ValidateMiddleware.validateArray;
export const validateFile = ValidateMiddleware.validateFile;

export default ValidateMiddleware;