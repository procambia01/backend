import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodTypeAny } from 'zod';
import { ValidationError } from '@/utils/error.util';

const details = (e: ZodError) => e.errors.map((x) => ({ field: x.path.join('.'), message: x.message, code: x.code }));

function make(target: 'body' | 'query' | 'params') {
  return (schema: ZodTypeAny) => (req: Request, _res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req[target]);
    if (!parsed.success) return next(new ValidationError('Validation failed', details(parsed.error)));
    // Replace with the parsed (trimmed, coerced, defaulted, unknown-keys-stripped) value.
    if (target === 'query') {
      Object.defineProperty(req, 'query', { value: parsed.data, writable: true, configurable: true });
    } else {
      (req as unknown as Record<string, unknown>)[target] = parsed.data;
    }
    next();
  };
}

export class ValidateMiddleware {
  static validateBody = make('body');
  static validateQuery = make('query');
  static validateParams = make('params');
}
export const validateBody = ValidateMiddleware.validateBody;
export const validateQuery = ValidateMiddleware.validateQuery;
export const validateParams = ValidateMiddleware.validateParams;
export default ValidateMiddleware;
