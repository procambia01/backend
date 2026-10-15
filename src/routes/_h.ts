import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import ResponseUtil from '@/utils/response.util';
import { objectId, paginationQuery } from '@/contracts';
import { asyncHandler } from '@/middleware/error.middleware';

export { Router } from 'express';
export { z };
export type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;

/** Wrap an async handler so rejections reach the central error handler. */
export const h = (fn: Handler): RequestHandler => asyncHandler(async (req: Request, res: Response, _n: NextFunction) => {
  await fn(req, res);
}) as RequestHandler;

export const ok = <T>(res: Response, data: T, meta: Record<string, unknown> = {}) => ResponseUtil.success(res, data, undefined, 200, meta);
export const created = <T>(res: Response, data: T) => ResponseUtil.created(res, data);
export const paged = <T>(res: Response, r: { items: T[]; total: number }, page: number, perPage: number) =>
  ResponseUtil.paginated(res, r.items, page, perPage, r.total);

export const idParams = z.object({ id: objectId });
export const pageQ = paginationQuery;
export const pageOf = (req: Request) => req.query as unknown as { page: number; perPage: number };
export const param = (req: Request, name = 'id') => String(req.params[name]);
export const file = (req: Request) => req.file as { buffer: Buffer; mimetype: string; originalname?: string } | undefined;
