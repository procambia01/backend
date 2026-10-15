import { Response } from 'express';
import type { PageMeta } from '@/contracts';

/** JSON replacer: BigInt would otherwise throw; emit decimal strings. */
export const jsonSafe = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export function pageMeta(page: number, perPage: number, total: number): PageMeta {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return { page, perPage, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 };
}

/**
 * Standard envelope for every response:
 *   { success: true,  data, meta, error: null }
 *   { success: false, data: null, error: { code, message, details } }
 */
export class ResponseUtil {
  static success<T>(res: Response, data?: T, _message?: string, statusCode = 200, meta: Record<string, unknown> = {}): Response {
    return res
      .status(statusCode)
      .type('application/json')
      .send(JSON.stringify({ success: true, data: data ?? null, meta, error: null }, jsonSafe));
  }

  static created<T>(res: Response, data: T, _message?: string): Response {
    return ResponseUtil.success(res, data, undefined, 201);
  }

  static paginated<T>(res: Response, data: T[], page: number, perPage: number, total: number): Response {
    return ResponseUtil.success(res, data, undefined, 200, pageMeta(page, perPage, total) as unknown as Record<string, unknown>);
  }

  static noContent(res: Response): Response {
    return res.status(204).send();
  }

  static error(res: Response, statusCode: number, code: string, message: string, details?: unknown): Response {
    return res
      .status(statusCode)
      .type('application/json')
      .send(JSON.stringify({ success: false, data: null, meta: {}, error: { code, message, details: details ?? null } }, jsonSafe));
  }
}

export default ResponseUtil;
