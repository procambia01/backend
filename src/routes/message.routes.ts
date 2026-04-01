import { Router } from 'express';
import { MessageController } from '@/controllers/message.controller';
import { authenticate } from '@/middleware/auth.middleware';
import { validateBody } from '@/middleware/validate.middleware';
import { sendMessageRateLimit } from '@/middleware/rateLimit.middleware';
import { uploadMessageAttachments } from '@/middleware/upload.middleware';
import {
  sendMessageValidator,
  editMessageValidator,
} from '@/validators/message.validator';
import { asyncHandler } from '@/middleware/error.middleware';

const router = Router();
const messageController = new MessageController();

/**
 * @route   GET /api/v1/messages/conversations
 * @desc    Get all conversations
 * @access  Private
 */
router.get(
  '/conversations',
  authenticate,
  asyncHandler(messageController.getConversations)
);

/**
 * @route   GET /api/v1/messages/conversations/:swapId
 * @desc    Get messages for a specific swap
 * @access  Private (Parties involved only)
 */
router.get(
  '/conversations/:swapId',
  authenticate,
  asyncHandler(messageController.getSwapMessages)
);

/**
 * @route   POST /api/v1/messages
 * @desc    Send a message
 * @access  Private
 */
router.post(
  '/',
  authenticate,
  sendMessageRateLimit,
  validateBody(sendMessageValidator),
  asyncHandler(messageController.sendMessage)
);

/**
 * @route   POST /api/v1/messages/attachments
 * @desc    Send message with attachments
 * @access  Private
 */
router.post(
  '/attachments',
  authenticate,
  sendMessageRateLimit,
  uploadMessageAttachments(),
  asyncHandler(messageController.sendMessageWithAttachments)
);

/**
 * @route   GET /api/v1/messages/:id
 * @desc    Get message by ID
 * @access  Private
 */
router.get(
  '/:id',
  authenticate,
  asyncHandler(messageController.getMessageById)
);

/**
 * @route   PUT /api/v1/messages/:id
 * @desc    Edit message
 * @access  Private (Sender only)
 */
router.put(
  '/:id',
  authenticate,
  validateBody(editMessageValidator),
  asyncHandler(messageController.editMessage)
);

/**
 * @route   DELETE /api/v1/messages/:id
 * @desc    Delete message
 * @access  Private (Sender only)
 */
router.delete(
  '/:id',
  authenticate,
  asyncHandler(messageController.deleteMessage)
);

/**
 * @route   POST /api/v1/messages/:id/read
 * @desc    Mark message as read
 * @access  Private
 */
router.post(
  '/:id/read',
  authenticate,
  asyncHandler(messageController.markAsRead)
);

/**
 * @route   POST /api/v1/messages/conversations/:swapId/read
 * @desc    Mark all messages in conversation as read
 * @access  Private
 */
router.post(
  '/conversations/:swapId/read',
  authenticate,
  asyncHandler(messageController.markConversationAsRead)
);

/**
 * @route   GET /api/v1/messages/unread/count
 * @desc    Get unread message count
 * @access  Private
 */
router.get(
  '/unread/count',
  authenticate,
  asyncHandler(messageController.getUnreadCount)
);

/**
 * @route   POST /api/v1/messages/:id/report
 * @desc    Report a message
 * @access  Private
 */
router.post(
  '/:id/report',
  authenticate,
  asyncHandler(messageController.reportMessage)
);

/**
 * @route   DELETE /api/v1/messages/conversations/:swapId
 * @desc    Delete entire conversation
 * @access  Private
 */
router.delete(
  '/conversations/:swapId',
  authenticate,
  asyncHandler(messageController.deleteConversation)
);

export default router;