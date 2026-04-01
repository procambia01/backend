// ============================================
// src/controllers/analytics.controller.ts
// ============================================
import { Request, Response } from 'express';
import { AnalyticsService } from '@/services/analytics.service';
import ResponseUtil from '@/utils/response.util';

export class AnalyticsController {
  private analyticsService: AnalyticsService;

  constructor() {
    this.analyticsService = new AnalyticsService();
  }

  getDashboard = async (req: Request, res: Response): Promise<Response> => {
    const dashboard = await this.analyticsService.getDashboardStats();
    return ResponseUtil.success(res, dashboard);
  };

  getUserAnalytics = async (req: Request, res: Response): Promise<Response> => {
    const { period } = req.query;
    const analytics = await this.analyticsService.getUserAnalytics(period as string);
    return ResponseUtil.success(res, analytics);
  };

  getSwapAnalytics = async (req: Request, res: Response): Promise<Response> => {
    const { period } = req.query;
    const analytics = await this.analyticsService.getSwapAnalytics(period as string);
    return ResponseUtil.success(res, analytics);
  };

  getRevenueAnalytics = async (req: Request, res: Response): Promise<Response> => {
    const { period } = req.query;
    const analytics = await this.analyticsService.getRevenueAnalytics(period as string);
    return ResponseUtil.success(res, analytics);
  };

  getGrowthAnalytics = async (req: Request, res: Response): Promise<Response> => {
    const { period } = req.query;
    const analytics = await this.analyticsService.getGrowthAnalytics(period as string);
    return ResponseUtil.success(res, analytics);
  };
}