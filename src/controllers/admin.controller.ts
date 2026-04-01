
import { Request, Response } from 'express';
import { AdminService } from '@/services/admin.service';
import ResponseUtil from '@/utils/response.util';
import PaginationUtil from '@/utils/pagination.util';

export class AdminController {
  private adminService: AdminService;

  constructor() {
    this.adminService = new AdminService();
  }

  // User Management
  getAllUsers = async (req: Request, res: Response): Promise<Response> => {
    const pagination = PaginationUtil.parseParams(req.query);
    const filters = req.query;
    const result = await this.adminService.getAllUsers(filters, pagination);
    return ResponseUtil.paginated(res, result.data, result.meta.page, result.meta.perPage, result.meta.total);
  };

  getUserDetails = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const user = await this.adminService.getUserDetails(id);
    return ResponseUtil.success(res, user);
  };

  updateUserRole = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const adminId = req.user!.userId;
    const { role } = req.body;
    const user = await this.adminService.updateUserRole(id, role, adminId);
    return ResponseUtil.success(res, user, 'User role updated');
  };

  banUser = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const adminId = req.user!.userId;
    const { reason, duration, permanent } = req.body;
    await this.adminService.banUser(id, reason, duration, permanent, adminId);
    return ResponseUtil.success(res, null, 'User banned');
  };

  unbanUser = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const adminId = req.user!.userId;
    await this.adminService.unbanUser(id, adminId);
    return ResponseUtil.success(res, null, 'User unbanned');
  };

  suspendUser = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const adminId = req.user!.userId;
    const { reason, duration } = req.body;
    await this.adminService.suspendUser(id, reason, duration, adminId);
    return ResponseUtil.success(res, null, 'User suspended');
  };

  deleteUser = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const adminId = req.user!.userId;
    await this.adminService.deleteUser(id, adminId);
    return ResponseUtil.success(res, null, 'User deleted');
  };

  // Verification Management
  getPendingVerifications = async (req: Request, res: Response): Promise<Response> => {
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.adminService.getPendingVerifications(pagination);
    return ResponseUtil.paginated(res, result.data, result.meta.page, result.meta.perPage, result.meta.total);
  };

  approveVerification = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const adminId = req.user!.userId;
    await this.adminService.approveVerification(id, adminId);
    return ResponseUtil.success(res, null, 'Verification approved');
  };

  rejectVerification = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const adminId = req.user!.userId;
    const { reason } = req.body;
    await this.adminService.rejectVerification(id, reason, adminId);
    return ResponseUtil.success(res, null, 'Verification rejected');
  };

  // Dispute Management
  getAllDisputes = async (req: Request, res: Response): Promise<Response> => {
    const pagination = PaginationUtil.parseParams(req.query);
    const filters = req.query;
    const result = await this.adminService.getAllDisputes(filters, pagination);
    return ResponseUtil.paginated(res, result.data, result.meta.page, result.meta.perPage, result.meta.total);
  };

  getPendingDisputes = async (req: Request, res: Response): Promise<Response> => {
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.adminService.getPendingDisputes(pagination);
    return ResponseUtil.paginated(res, result.data, result.meta.page, result.meta.perPage, result.meta.total);
  };

  // Content Moderation
  getAllReports = async (req: Request, res: Response): Promise<Response> => {
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.adminService.getAllReports(pagination);
    return ResponseUtil.paginated(res, result.data, result.meta.page, result.meta.perPage, result.meta.total);
  };

  resolveReport = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const adminId = req.user!.userId;
    const { action, notes } = req.body;
    await this.adminService.resolveReport(id, action, notes, adminId);
    return ResponseUtil.success(res, null, 'Report resolved');
  };

  // System Configuration
  getSystemConfig = async (req: Request, res: Response): Promise<Response> => {
    const config = await this.adminService.getSystemConfig();
    return ResponseUtil.success(res, config);
  };

  updateSystemConfig = async (req: Request, res: Response): Promise<Response> => {
    const adminId = req.user!.userId;
    const { key, value, description } = req.body;
    await this.adminService.updateSystemConfig(key, value, description, adminId);
    return ResponseUtil.success(res, null, 'Configuration updated');
  };

  // Activity Logs
  getAdminLogs = async (req: Request, res: Response): Promise<Response> => {
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.adminService.getAdminLogs(pagination);
    return ResponseUtil.paginated(res, result.data, result.meta.page, result.meta.perPage, result.meta.total);
  };

  getActivityLogs = async (req: Request, res: Response): Promise<Response> => {
    const { userId, action } = req.query;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.adminService.getActivityLogs(
      userId as string,
      action as string,
      pagination
    );
    return ResponseUtil.paginated(res, result.data, result.meta.page, result.meta.perPage, result.meta.total);
  };
}
