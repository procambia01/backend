import { Router as AdminRouter } from 'express';
import { AdminController } from '@/controllers/admin.controller';
import { authenticate } from '@/middleware/auth.middleware';
import { requireAdmin, requireSuperAdmin, checkRoleHierarchy } from '@/middleware/role.middleware';
import { validateBody } from '@/middleware/validate.middleware';
import { updateUserRoleValidator, banUserValidator } from '@/validators/admin.validator';
import { asyncHandler } from '@/middleware/error.middleware';
import { logAdminAction } from '@/middleware/logger.middleware';

const adminRouter = AdminRouter();
const adminController = new AdminController();

// User Management
adminRouter.get('/users', authenticate, requireAdmin, asyncHandler(adminController.getAllUsers));
adminRouter.get('/users/:id', authenticate, requireAdmin, asyncHandler(adminController.getUserDetails));
adminRouter.put('/users/:id/role', authenticate, requireAdmin, checkRoleHierarchy('id'), logAdminAction('UPDATE_USER_ROLE'), validateBody(updateUserRoleValidator), asyncHandler(adminController.updateUserRole));
adminRouter.post('/users/:id/ban', authenticate, requireAdmin, checkRoleHierarchy('id'), logAdminAction('BAN_USER'), validateBody(banUserValidator), asyncHandler(adminController.banUser));
adminRouter.post('/users/:id/unban', authenticate, requireAdmin, logAdminAction('UNBAN_USER'), asyncHandler(adminController.unbanUser));
adminRouter.post('/users/:id/suspend', authenticate, requireAdmin, checkRoleHierarchy('id'), logAdminAction('SUSPEND_USER'), asyncHandler(adminController.suspendUser));
adminRouter.delete('/users/:id', authenticate, requireSuperAdmin, checkRoleHierarchy('id'), logAdminAction('DELETE_USER'), asyncHandler(adminController.deleteUser));

// Verification Management
adminRouter.get('/verifications/pending', authenticate, requireAdmin, asyncHandler(adminController.getPendingVerifications));
adminRouter.post('/verifications/:id/approve', authenticate, requireAdmin, logAdminAction('APPROVE_VERIFICATION'), asyncHandler(adminController.approveVerification));
adminRouter.post('/verifications/:id/reject', authenticate, requireAdmin, logAdminAction('REJECT_VERIFICATION'), asyncHandler(adminController.rejectVerification));

// Dispute Management
adminRouter.get('/disputes', authenticate, requireAdmin, asyncHandler(adminController.getAllDisputes));
adminRouter.get('/disputes/pending', authenticate, requireAdmin, asyncHandler(adminController.getPendingDisputes));

// Content Moderation
adminRouter.get('/reports', authenticate, requireAdmin, asyncHandler(adminController.getAllReports));
adminRouter.post('/reports/:id/resolve', authenticate, requireAdmin, logAdminAction('RESOLVE_REPORT'), asyncHandler(adminController.resolveReport));

// System Configuration
adminRouter.get('/config', authenticate, requireSuperAdmin, asyncHandler(adminController.getSystemConfig));
adminRouter.put('/config', authenticate, requireSuperAdmin, logAdminAction('UPDATE_CONFIG'), asyncHandler(adminController.updateSystemConfig));

// Activity Logs
adminRouter.get('/logs/admin', authenticate, requireSuperAdmin, asyncHandler(adminController.getAdminLogs));
adminRouter.get('/logs/activity', authenticate, requireAdmin, asyncHandler(adminController.getActivityLogs));

export { adminRouter as default };
