// src/routes/notification.routes.ts
import { Router } from 'express';
import { NotificationController } from '@/controllers/notification.controller';
import { authenticate } from '@/middleware/auth.middleware';
import { asyncHandler } from '@/middleware/error.middleware';

const notificationRouter = Router();
const notificationController = new NotificationController();

notificationRouter.get('/', authenticate, asyncHandler(notificationController.getNotifications));
notificationRouter.get('/unread', authenticate, asyncHandler(notificationController.getUnreadNotifications));
notificationRouter.get('/unread/count', authenticate, asyncHandler(notificationController.getUnreadCount));
notificationRouter.post('/:id/read', authenticate, asyncHandler(notificationController.markAsRead));
notificationRouter.post('/read-all', authenticate, asyncHandler(notificationController.markAllAsRead));
notificationRouter.delete('/:id', authenticate, asyncHandler(notificationController.deleteNotification));
notificationRouter.delete('/', authenticate, asyncHandler(notificationController.deleteAllNotifications));

export { notificationRouter as default };
