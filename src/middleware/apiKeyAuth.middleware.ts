import { NextFunction, Request, Response } from 'express';
import { apiKeyService } from '@/services/apikey.service';

/** Authenticates partner API calls via `X-API-Key` and attaches `req.apiKey`. Never grants access to private data. */
export const apiKeyAuth = (scope: string) => (req: Request, _res: Response, next: NextFunction): void => {
  apiKeyService
    .authenticate(req.get('x-api-key'), scope)
    .then((ctx) => {
      req.apiKey = ctx;
      next();
    })
    .catch(next);
};
