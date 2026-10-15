import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
  userId?: string;
  route?: string;
  ip?: string;
  userAgent?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
export const getContext = (): RequestContext | undefined => requestContext.getStore();
