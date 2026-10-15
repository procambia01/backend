import { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '@/utils/error.util';

const LEVEL: Record<UserRole, number> = { USER: 1, STAFF: 2, ADMIN: 3, SUPER_ADMIN: 4 };

export class RoleMiddleware {
  static requireRole = (...roles: UserRole[]) => (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roles.includes(req.user.role)) return next(new ForbiddenError('Insufficient permissions'));
    next();
  };

  static requireMinRole = (min: UserRole) => (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (LEVEL[req.user.role] < LEVEL[min]) return next(new ForbiddenError('Insufficient permissions'));
    next();
  };

  static requireStaff = RoleMiddleware.requireMinRole('STAFF');
  static requireAdmin = RoleMiddleware.requireMinRole('ADMIN');
  static requireSuperAdmin = RoleMiddleware.requireMinRole('SUPER_ADMIN');
}

export default RoleMiddleware;
