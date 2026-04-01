import { Request, Response } from 'express';
import ResponseUtil from '@/utils/response.util';
import PaginationUtil from '@/utils/pagination.util';
import { NotificationService } from '@/services/notification.service';

export class NotificationController {
  private notificationService: NotificationService;

  constructor() {
    this.notificationService = new NotificationService();
  }

  getNotifications = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.notificationService.getNotifications(userId, pagination);
    return ResponseUtil.paginated(res, result.data, result.meta.page, result.meta.perPage, result.meta.total);
  };

  getUnreadNotifications = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const notifications = await this.notificationService.getUnreadNotifications(userId);
    return ResponseUtil.success(res, notifications);
  };

  getUnreadCount = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const count = await this.notificationService.getUnreadCount(userId);
    return ResponseUtil.success(res, { count });
  };

  markAsRead = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    await this.notificationService.markAsRead(id, userId);
    return ResponseUtil.success(res, null, 'Notification marked as read');
  };

  markAllAsRead = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    await this.notificationService.markAllAsRead(userId);
    return ResponseUtil.success(res, null, 'All notifications marked as read');
  };

  deleteNotification = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    await this.notificationService.deleteNotification(id, userId);
    return ResponseUtil.success(res, null, 'Notification deleted');
  };

  deleteAllNotifications = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    await this.notificationService.deleteAllNotifications(userId);
    return ResponseUtil.success(res, null, 'All notifications deleted');
  };
}
