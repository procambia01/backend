import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '@/utils/error.util';
import prisma from '@/config/database';

export enum UserRole {
  USER = 'USER',
  STAFF = 'STAFF',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

// Role hierarchy (higher number = more privileges)
const ROLE_HIERARCHY: Record<UserRole, number> = {
  [UserRole.USER]: 1,
  [UserRole.STAFF]: 2,
  [UserRole.ADMIN]: 3,
  [UserRole.SUPER_ADMIN]: 4,
};

export class RoleMiddleware {
  /**
   * Require specific role(s)
   */
  static requireRole(...allowedRoles: UserRole[]) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.user) {
          throw new UnauthorizedError('Authentication required');
        }

        const userRole = req.user.role as UserRole;

        if (!allowedRoles.includes(userRole)) {
          throw new ForbiddenError(`Insufficient permissions. Required role(s): ${allowedRoles.join(', ')}`);
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Require minimum role level
   */
  static requireMinRole(minRole: UserRole) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.user) {
          throw new UnauthorizedError('Authentication required');
        }

        const userRole = req.user.role as UserRole;
        const userRoleLevel = ROLE_HIERARCHY[userRole];
        const minRoleLevel = ROLE_HIERARCHY[minRole];

        if (userRoleLevel < minRoleLevel) {
          throw new ForbiddenError(`Insufficient permissions. Minimum required role: ${minRole}`);
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Check if user is admin (ADMIN or SUPER_ADMIN)
   */
  static requireAdmin(req: Request, res: Response, next: NextFunction): void {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const userRole = req.user.role as UserRole;

      if (userRole !== UserRole.ADMIN && userRole !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenError('Admin access required');
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check if user is super admin
   */
  static requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const userRole = req.user.role as UserRole;

      if (userRole !== UserRole.SUPER_ADMIN) {
        throw new ForbiddenError('Super admin access required');
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check if user is staff or higher
   */
  static requireStaff(req: Request, res: Response, next: NextFunction): void {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Authentication required');
      }

      const userRole = req.user.role as UserRole;
      const allowedRoles = [UserRole.STAFF, UserRole.ADMIN, UserRole.SUPER_ADMIN];

      if (!allowedRoles.includes(userRole)) {
        throw new ForbiddenError('Staff access required');
      }

      next();
    } catch (error) {
      next(error);
    }
  }

  /**
   * Check if user has specific permission
   */
  static requirePermission(...permissions: string[]) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.user) {
          throw new UnauthorizedError('Authentication required');
        }

        // Super admins have all permissions
        if (req.user.role === UserRole.SUPER_ADMIN) {
          return next();
        }

        // Get user permissions from database
        const user = await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: { permissions: true },
        });

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check if user has at least one of the required permissions
        const hasPermission = permissions.some(permission =>
          user.permissions.includes(permission)
        );

        if (!hasPermission) {
          throw new ForbiddenError(`Required permission(s): ${permissions.join(', ')}`);
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Check if user has all specified permissions
   */
  static requireAllPermissions(...permissions: string[]) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.user) {
          throw new UnauthorizedError('Authentication required');
        }

        // Super admins have all permissions
        if (req.user.role === UserRole.SUPER_ADMIN) {
          return next();
        }

        // Get user permissions from database
        const user = await prisma.user.findUnique({
          where: { id: req.user.userId },
          select: { permissions: true },
        });

        if (!user) {
          throw new UnauthorizedError('User not found');
        }

        // Check if user has all required permissions
        const hasAllPermissions = permissions.every(permission =>
          user.permissions.includes(permission)
        );

        if (!hasAllPermissions) {
          throw new ForbiddenError(`Required permissions: ${permissions.join(', ')}`);
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Allow only the user themselves or admin
   */
  static requireSelfOrAdmin(userIdParam: string = 'id') {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.user) {
          throw new UnauthorizedError('Authentication required');
        }

        const targetUserId = req.params[userIdParam];
        const userRole = req.user.role as UserRole;

        // Allow if user is accessing their own resource
        if (targetUserId === req.user.userId) {
          return next();
        }

        // Allow if user is admin
        if (userRole === UserRole.ADMIN || userRole === UserRole.SUPER_ADMIN) {
          return next();
        }

        throw new ForbiddenError('You can only access your own resources');
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Check role hierarchy (can user perform action on target user)
   */
  static checkRoleHierarchy(targetUserIdParam: string = 'id') {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.user) {
          throw new UnauthorizedError('Authentication required');
        }

        const targetUserId = req.params[targetUserIdParam];
        const currentUserRole = req.user.role as UserRole;

        // Get target user's role
        const targetUser = await prisma.user.findUnique({
          where: { id: targetUserId },
          select: { role: true },
        });

        if (!targetUser) {
          throw new ForbiddenError('Target user not found');
        }

        const targetUserRole = targetUser.role as UserRole;

        // Check hierarchy
        const currentUserLevel = ROLE_HIERARCHY[currentUserRole];
        const targetUserLevel = ROLE_HIERARCHY[targetUserRole];

        if (currentUserLevel <= targetUserLevel) {
          throw new ForbiddenError('Insufficient permissions to perform this action on this user');
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  /**
   * Get user role level
   */
  static getRoleLevel(role: UserRole): number {
    return ROLE_HIERARCHY[role];
  }

  /**
   * Check if role A is higher than role B
   */
  static isRoleHigher(roleA: UserRole, roleB: UserRole): boolean {
    return ROLE_HIERARCHY[roleA] > ROLE_HIERARCHY[roleB];
  }

  /**
   * Check if user can manage role
   */
  static canManageRole(userRole: UserRole, targetRole: UserRole): boolean {
    return ROLE_HIERARCHY[userRole] > ROLE_HIERARCHY[targetRole];
  }
}

// Export middleware functions
export const requireRole = RoleMiddleware.requireRole;
export const requireMinRole = RoleMiddleware.requireMinRole;
export const requireAdmin = RoleMiddleware.requireAdmin;
export const requireSuperAdmin = RoleMiddleware.requireSuperAdmin;
export const requireStaff = RoleMiddleware.requireStaff;
export const requirePermission = RoleMiddleware.requirePermission;
export const requireAllPermissions = RoleMiddleware.requireAllPermissions;
export const requireSelfOrAdmin = RoleMiddleware.requireSelfOrAdmin;
export const checkRoleHierarchy = RoleMiddleware.checkRoleHierarchy;

export default RoleMiddleware;