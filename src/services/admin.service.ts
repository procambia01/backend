// src/services/admin.service.ts
import { prisma } from '@/config/database';
import { PaginationParams } from '@/utils/pagination.util';
import { UserRole, AdminAction, DisputeStatus } from '@prisma/client';
import { 
  NotFoundError, 
  BadRequestError, 
  ForbiddenError 
} from '@/utils/error.util';
import logger from '@/utils/logger.util';
// import { VerificationStatus } from '@prisma/client';

export class AdminService {
  /**
   * Get all users with filters and pagination
   */
  async getAllUsers(filters: any, pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const where: any = {};

    // Apply filters
    if (filters.role) {
      where.role = filters.role;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive === 'true';
    }
    if (filters.isBanned !== undefined) {
      where.isBanned = filters.isBanned === 'true';
    }
    if (filters.isPremium !== undefined) {
      where.isPremium = filters.isPremium === 'true';
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          role: true,
          isActive: true,
          isBanned: true,
          isPremium: true,
          emailVerified: true,
          phoneVerified: true,
          idVerified: true,
          rating: true,
          totalSwaps: true,
          trustScore: true,
          createdAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return {
      data: users,
      meta: { page, perPage, total },
    };
  }

  /**
   * Get user details by ID
   */
  async getUserDetails(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        offersCreated: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        swapsAsInitiator: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        swapsAsReceiver: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        disputes: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        ratingsReceived: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return user;
  }

  /**
   * Update user role
   */
  async updateUserRole(userId: string, role: UserRole, adminId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role },
    });

    await prisma.adminLog.create({
      data: {
        adminId,
        action: AdminAction.ROLE_CHANGED,
        targetType: 'User',
        targetId: userId,
        details: `Role changed from ${user.role} to ${role}`,
        changes: {
          before: { role: user.role },
          after: { role },
        },
      },
    });

    logger.info(`User ${userId} role updated to ${role} by admin ${adminId}`);

    return updatedUser;
  }

  /**
   * Ban user
   */
  async banUser(
    userId: string,
    reason: string,
    duration: number,
    permanent: boolean,
    adminId: string
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Cannot ban super admin');
    }

    const banExpiry = permanent
      ? null
      : new Date(Date.now() + duration * 24 * 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: true,
        isActive: false,
        banReason: reason,
        bannedAt: new Date(),
        bannedBy: adminId,
        banExpiry,
      },
    });

    await prisma.adminLog.create({
      data: {
        adminId,
        action: AdminAction.USER_BANNED,
        targetType: 'User',
        targetId: userId,
        details: reason,
        changes: {
          duration: permanent ? 'permanent' : `${duration} days`,
          reason,
        },
      },
    });

    logger.info(`User ${userId} banned by admin ${adminId}`);
  }

  /**
   * Unban user
   */
  async unbanUser(userId: string, adminId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (!user.isBanned) {
      throw new BadRequestError('User is not banned');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        isBanned: false,
        isActive: true,
        banReason: null,
        bannedAt: null,
        bannedBy: null,
        banExpiry: null,
      },
    });

    await prisma.adminLog.create({
      data: {
        adminId,
        action: AdminAction.USER_UNBANNED,
        targetType: 'User',
        targetId: userId,
        details: 'User unbanned',
      },
    });

    logger.info(`User ${userId} unbanned by admin ${adminId}`);
  }

  /**
   * Suspend user temporarily
   */
  async suspendUser(
    userId: string,
    reason: string,
    duration: number,
    adminId: string
  ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        banReason: reason,
        bannedAt: new Date(),
        bannedBy: adminId,
        banExpiry: new Date(Date.now() + duration * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.adminLog.create({
      data: {
        adminId,
        action: AdminAction.USER_BANNED,
        targetType: 'User',
        targetId: userId,
        details: `Suspended for ${duration} days: ${reason}`,
      },
    });

    logger.info(`User ${userId} suspended by admin ${adminId}`);
  }

  /**
   * Delete user (soft delete)
   */
  async deleteUser(userId: string, adminId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    if (user.role === UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Cannot delete super admin');
    }

    // Soft delete - deactivate instead of hard delete
    await prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false,
        isBanned: true,
        banReason: 'Account deleted by admin',
      },
    });

    await prisma.adminLog.create({
      data: {
        adminId,
        action: AdminAction.CONTENT_MODERATED,
        targetType: 'User',
        targetId: userId,
        details: 'User account deleted',
      },
    });

    logger.info(`User ${userId} deleted by admin ${adminId}`);
  }

  /**
   * Get pending verifications
   */
  async getPendingVerifications(pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where: {
          idVerified: false,
          idDocumentUrl: { not: null },
        },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          idDocumentUrl: true,
          selfieUrl: true,
          createdAt: true,
        },
      }),
      prisma.user.count({
        where: {
          idVerified: false,
          idDocumentUrl: { not: null },
        },
      }),
    ]);

    return {
      data: users,
      meta: { page, perPage, total },
    };
  }

  /**
   * Approve verification
   */
  async approveVerification(userId: string, adminId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        idVerified: true,
        verificationFeePaid: true,
      },
    });

    await prisma.adminLog.create({
      data: {
        adminId,
        action: AdminAction.USER_VERIFIED,
        targetType: 'User',
        targetId: userId,
        details: 'ID verification approved',
      },
    });

    // Send notification to user
    await prisma.notification.create({
      data: {
        userId,
        type: 'VERIFICATION_APPROVED',
        title: 'Verification Approved',
        message: 'Your ID verification has been approved!',
      },
    });

    logger.info(`Verification approved for user ${userId} by admin ${adminId}`);
  }

  /**
   * Reject verification
   */
  async rejectVerification(userId: string, reason: string, adminId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        idVerified: false,
        idDocumentUrl: null,
        selfieUrl: null,
      },
    });

    await prisma.adminLog.create({
      data: {
        adminId,
        action: AdminAction.USER_REJECTED,
        targetType: 'User',
        targetId: userId,
        details: `Verification rejected: ${reason}`,
      },
    });

    // Send notification to user
    await prisma.notification.create({
      data: {
        userId,
        type: 'VERIFICATION_REJECTED',
        title: 'Verification Rejected',
        message: `Your ID verification was rejected. Reason: ${reason}`,
      },
    });

    logger.info(`Verification rejected for user ${userId} by admin ${adminId}`);
  }

  /**
   * Get all disputes with filters
   */
  async getAllDisputes(filters: any, pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const where: any = {};

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.priority) {
      where.priority = filters.priority;
    }

    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          reporter: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          swap: {
            include: {
              initiator: {
                select: { id: true, name: true },
              },
              receiver: {
                select: { id: true, name: true },
              },
            },
          },
        },
      }),
      prisma.dispute.count({ where }),
    ]);

    return {
      data: disputes,
      meta: { page, perPage, total },
    };
  }

  /**
   * Get pending disputes
   */
  async getPendingDisputes(pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [disputes, total] = await Promise.all([
      prisma.dispute.findMany({
        where: {
          status: {
            in: [DisputeStatus.OPEN, DisputeStatus.INVESTIGATING],
          },
        },
        skip,
        take: perPage,
        orderBy: { priority: 'desc' },
        include: {
          reporter: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          swap: {
            include: {
              initiator: {
                select: { id: true, name: true },
              },
              receiver: {
                select: { id: true, name: true },
              },
            },
          },
        },
      }),
      prisma.dispute.count({
        where: {
          status: {
            in: [DisputeStatus.OPEN, DisputeStatus.INVESTIGATING],
          },
        },
      }),
    ]);

    return {
      data: disputes,
      meta: { page, perPage, total },
    };
  }

  /**
   * Get all reports (ratings with reports)
   */
  async getAllReports(pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [reports, total] = await Promise.all([
      prisma.rating.findMany({
        where: {
          isReported: true,
        },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          giver: {
            select: { id: true, name: true },
          },
          receiver: {
            select: { id: true, name: true },
          },
          swap: {
            select: { id: true, status: true },
          },
        },
      }),
      prisma.rating.count({
        where: {
          isReported: true,
        },
      }),
    ]);

    return {
      data: reports,
      meta: { page, perPage, total },
    };
  }

  /**
   * Resolve report
   */
  async resolveReport(
    reportId: string,
    action: 'hide' | 'delete' | 'ignore',
    notes: string,
    adminId: string
  ) {
    const report = await prisma.rating.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundError('Report not found');
    }

    if (action === 'hide') {
      await prisma.rating.update({
        where: { id: reportId },
        data: { isHidden: true },
      });
    } else if (action === 'delete') {
      await prisma.rating.delete({
        where: { id: reportId },
      });
    }
    // If 'ignore', do nothing to the rating

    await prisma.adminLog.create({
      data: {
        adminId,
        action: AdminAction.CONTENT_MODERATED,
        targetType: 'Rating',
        targetId: reportId,
        details: `Report resolved: ${action} - ${notes}`,
      },
    });

    logger.info(`Report ${reportId} resolved by admin ${adminId}`);
  }

  /**
   * Get system config
   */
  async getSystemConfig() {
    const config = await prisma.systemConfig.findMany({
      orderBy: { category: 'asc' },
    });

    return config;
  }

  /**
   * Update system config
   */
  async updateSystemConfig(
    key: string,
    value: string,
    description: string,
    adminId: string
  ) {
    const existingConfig = await prisma.systemConfig.findUnique({
      where: { key },
    });

    if (existingConfig) {
      await prisma.systemConfig.update({
        where: { key },
        data: { value, description },
      });
    } else {
      await prisma.systemConfig.create({
        data: { key, value, description },
      });
    }

    await prisma.adminLog.create({
      data: {
        adminId,
        action: AdminAction.SYSTEM_CONFIG_UPDATED,
        targetType: 'SystemConfig',
        targetId: key,
        details: `Config ${key} updated`,
        changes: {
          before: existingConfig?.value,
          after: value,
        },
      },
    });

    logger.info(`System config ${key} updated by admin ${adminId}`);
  }

  /**
   * Get admin logs
   */
  async getAdminLogs(pagination: PaginationParams) {
    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [logs, total] = await Promise.all([
      prisma.adminLog.findMany({
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.adminLog.count(),
    ]);

    return {
      data: logs,
      meta: { page, perPage, total },
    };
  }

  /**
   * Get activity logs
   */
  async getActivityLogs(
    userId?: string,
    action?: string,
    pagination?: PaginationParams
  ) {
    const { page, perPage } = pagination || { page: 1, perPage: 20 };
    const skip = (page - 1) * perPage;

    const where: any = {};

    if (userId) {
      where.userId = userId;
    }
    if (action) {
      where.action = action;
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.activityLog.count({ where }),
    ]);

    return {
      data: logs,
      meta: { page, perPage, total },
    };
  }
}