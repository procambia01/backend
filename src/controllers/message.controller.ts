import { Request, Response } from 'express';
import { MessageService } from '@/services/message.service';
import ResponseUtil from '@/utils/response.util';
import PaginationUtil from '@/utils/pagination.util';

export class MessageController {
  private messageService: MessageService;

  constructor() {
    this.messageService = new MessageService();
  }

  /**
   * Get all conversations
   */
  getConversations = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const conversations = await this.messageService.getConversations(userId);
    return ResponseUtil.success(res, conversations);
  };

  /**
   * Get messages for a swap
   */
  getSwapMessages = async (req: Request, res: Response): Promise<Response> => {
    const { swapId } = req.params;
    const userId = req.user!.userId;
    const pagination = PaginationUtil.parseParams(req.query);
    const result = await this.messageService.getSwapMessages(swapId, userId, pagination);
    return ResponseUtil.paginated(
      res,
      result.data,
      result.meta.page,
      result.meta.perPage,
      result.meta.total
    );
  };

  /**
   * Send message
   */
  sendMessage = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { swapId, content, messageType } = req.body;
    const message = await this.messageService.sendMessage(
      userId,
      swapId,
      content,
      messageType
    );
    return ResponseUtil.created(res, message, 'Message sent');
  };

  /**
   * Send message with attachments
   */
  sendMessageWithAttachments = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const { swapId, content } = req.body;
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      return ResponseUtil.badRequest(res, 'No attachments provided');
    }

    const message = await this.messageService.sendMessageWithAttachments(
      userId,
      swapId,
      content,
      files
    );
    return ResponseUtil.created(res, message, 'Message sent with attachments');
  };

  /**
   * Get message by ID
   */
  getMessageById = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const message = await this.messageService.getMessageById(id, userId);
    return ResponseUtil.success(res, message);
  };

  /**
   * Edit message
   */
  editMessage = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { content } = req.body;
    const message = await this.messageService.editMessage(id, userId, content);
    return ResponseUtil.success(res, message, 'Message updated');
  };

  /**
   * Delete message
   */
  deleteMessage = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    await this.messageService.deleteMessage(id, userId);
    return ResponseUtil.success(res, null, 'Message deleted');
  };

  /**
   * Mark message as read
   */
  markAsRead = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    await this.messageService.markAsRead(id, userId);
    return ResponseUtil.success(res, null, 'Message marked as read');
  };

  /**
   * Mark conversation as read
   */
  markConversationAsRead = async (req: Request, res: Response): Promise<Response> => {
    const { swapId } = req.params;
    const userId = req.user!.userId;
    await this.messageService.markConversationAsRead(swapId, userId);
    return ResponseUtil.success(res, null, 'Conversation marked as read');
  };

  /**
   * Get unread message count
   */
  getUnreadCount = async (req: Request, res: Response): Promise<Response> => {
    const userId = req.user!.userId;
    const count = await this.messageService.getUnreadCount(userId);
    return ResponseUtil.success(res, { count });
  };

  /**
   * Report message
   */
  reportMessage = async (req: Request, res: Response): Promise<Response> => {
    const { id } = req.params;
    const userId = req.user!.userId;
    const { reason, description } = req.body;
    await this.messageService.reportMessage(id, userId, reason, description);
    return ResponseUtil.success(res, null, 'Message reported');
  };

  /**
   * Delete conversation
   */
  deleteConversation = async (req: Request, res: Response): Promise<Response> => {
    const { swapId } = req.params;
    const userId = req.user!.userId;
    await this.messageService.deleteConversation(swapId, userId);
    return ResponseUtil.success(res, null, 'Conversation deleted');
  };
}