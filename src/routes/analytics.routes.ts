
import { Router as AnalyticsRouter } from 'express';
import { AnalyticsController } from '@/controllers/analytics.controller';
import { authenticate } from '@/middleware/auth.middleware';
import { requireStaff } from '@/middleware/role.middleware';
import { asyncHandler } from '@/middleware/error.middleware';

const analyticsRouter = AnalyticsRouter();
const analyticsController = new AnalyticsController();

analyticsRouter.get('/dashboard', authenticate, requireStaff, asyncHandler(analyticsController.getDashboard));
analyticsRouter.get('/users', authenticate, requireStaff, asyncHandler(analyticsController.getUserAnalytics));
analyticsRouter.get('/swaps', authenticate, requireStaff, asyncHandler(analyticsController.getSwapAnalytics));
analyticsRouter.get('/revenue', authenticate, requireStaff, asyncHandler(analyticsController.getRevenueAnalytics));
analyticsRouter.get('/growth', authenticate, requireStaff, asyncHandler(analyticsController.getGrowthAnalytics));

export { analyticsRouter as default };

