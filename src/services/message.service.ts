// src/services/message.service.ts
import { prisma } from '@/config/database';
import { PaginationParams } from '@/utils/pagination.util';
import { MessageType } from '@prisma/client';
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
} from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { UploadService } from './upload.service';

export class MessageService {
  private uploadService: UploadService;

  constructor() {
    this.uploadService = new UploadService();
  }

  /**
   * Get all conversations for a user
   */
  async getConversations(userId: string) {
    // Get all swaps where user is involved
    const swaps = await prisma.swap.findMany({
      where: {
        OR: [{ initiatorId: userId }, { receiverId: userId }],
      },
      include: {
        initiator: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
            rating: true,
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          where: { isDeleted: false },
          select: {
            id: true,
            content: true,
            createdAt: true,
            isRead: true,
            senderId: true,
            messageType: true,
          },
        },
        _count: {
          select: {
            messages: {
              where: {
                senderId: { not: userId },
                isRead: false,
                isDeleted: false,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Format conversations
    const conversations = swaps.map(swap => {
      const otherUser =
        swap.initiatorId === userId ? swap.receiver : swap.initiator;
      const lastMessage = swap.messages[0] || null;
      const unreadCount = swap._count.messages;

      return {
        swapId: swap.id,
        otherUser,
        lastMessage,
        unreadCount,
        updatedAt: swap.updatedAt,
      };
    });

    return conversations;
  }

  /**
   * Get messages for a specific swap
   */
  async getSwapMessages(
    swapId: string,
    userId: string,
    pagination: PaginationParams
  ) {
    // Verify user has access to this swap
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this conversation');
    }

    const { page, perPage } = pagination;
    const skip = (page - 1) * perPage;

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: {
          swapId,
          isDeleted: false,
        },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              image: true,
              rating: true,
            },
          },
        },
      }),
      prisma.message.count({
        where: {
          swapId,
          isDeleted: false,
        },
      }),
    ]);

    return {
      data: messages.reverse(), // Return in chronological order
      meta: {
        page,
        perPage,
        total,
        totalPages: Math.ceil(total / perPage),
        hasMore: page < Math.ceil(total / perPage),
      },
    };
  }

  /**
   * Send a message
   */
  async sendMessage(
    userId: string,
    swapId: string,
    content: string,
    messageType: MessageType = MessageType.TEXT
  ) {
    // Verify swap exists and user has access
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
      include: {
        initiator: {
          select: {
            id: true,
            name: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this conversation');
    }

    if (!content || content.trim().length === 0) {
      throw new BadRequestError('Message content cannot be empty');
    }

    const message = await prisma.message.create({
      data: {
        swapId,
        senderId: userId,
        content: content.trim(),
        messageType,
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    // Update swap's updatedAt
    await prisma.swap.update({
      where: { id: swapId },
      data: { updatedAt: new Date() },
    });

    // Send notification to the other user
    const recipientId = swap.initiatorId === userId ? swap.receiverId : swap.initiatorId;
    const senderName = swap.initiatorId === userId ? swap.initiator.name : swap.receiver.name;

    await prisma.notification.create({
      data: {
        userId: recipientId,
        type: 'MESSAGE_RECEIVED',
        title: 'New Message',
        message: `${senderName} sent you a message`,
        link: `/swaps/${swapId}/messages`,
        data: {
          swapId,
          messageId: message.id,
        },
      },
    });

    logger.info(`Message sent: ${message.id} in swap ${swapId}`);

    return message;
  }

  /**
   * Send message with attachments
   */
  async sendMessageWithAttachments(
    userId: string,
    swapId: string,
    content: string,
    files: Express.Multer.File[]
  ) {
    // Verify swap exists and user has access
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
      include: {
        initiator: {
          select: {
            id: true,
            name: true,
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this conversation');
    }

    // Upload files to Cloudinary
    const uploadPromises = files.map(file =>
      this.uploadService.uploadMessageAttachment(file, swapId)
    );
    const uploadedFiles = await Promise.all(uploadPromises);

    const attachmentUrls = uploadedFiles.map(file => file.secure_url);

    const message = await prisma.message.create({
      data: {
        swapId,
        senderId: userId,
        content: content || '',
        messageType: MessageType.IMAGE,
        attachments: attachmentUrls,
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    // Update swap's updatedAt
    await prisma.swap.update({
      where: { id: swapId },
      data: { updatedAt: new Date() },
    });

    // Send notification
    const recipientId = swap.initiatorId === userId ? swap.receiverId : swap.initiatorId;
    const senderName = swap.initiatorId === userId ? swap.initiator.name : swap.receiver.name;

    await prisma.notification.create({
      data: {
        userId: recipientId,
        type: 'MESSAGE_RECEIVED',
        title: 'New Message',
        message: `${senderName} sent you ${files.length} attachment(s)`,
        link: `/swaps/${swapId}/messages`,
        data: {
          swapId,
          messageId: message.id,
        },
      },
    });

    logger.info(`Message with attachments sent: ${message.id} in swap ${swapId}`);

    return message;
  }

  /**
   * Get message by ID
   */
  async getMessageById(messageId: string, userId: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        swap: {
          select: {
            id: true,
            initiatorId: true,
            receiverId: true,
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    // Check if user has access
    if (
      message.swap.initiatorId !== userId &&
      message.swap.receiverId !== userId
    ) {
      throw new ForbiddenError('You do not have access to this message');
    }

    return message;
  }

  /**
   * Edit a message
   */
  async editMessage(messageId: string, userId: string, content: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenError('You can only edit your own messages');
    }

    if (message.isDeleted) {
      throw new BadRequestError('Cannot edit a deleted message');
    }

    if (!content || content.trim().length === 0) {
      throw new BadRequestError('Message content cannot be empty');
    }

    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: {
        content: content.trim(),
        isEdited: true,
        editedAt: new Date(),
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    });

    logger.info(`Message edited: ${messageId} by user ${userId}`);

    return updatedMessage;
  }

  /**
   * Delete a message (soft delete)
   */
  async deleteMessage(messageId: string, userId: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenError('You can only delete your own messages');
    }

    await prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        content: '[Message deleted]',
      },
    });

    logger.info(`Message deleted: ${messageId} by user ${userId}`);
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string, userId: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        swap: true,
      },
    });

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    // Can only mark messages you received as read
    if (message.senderId === userId) {
      throw new BadRequestError('Cannot mark your own message as read');
    }

    // Verify user has access to this conversation
    if (
      message.swap.initiatorId !== userId &&
      message.swap.receiverId !== userId
    ) {
      throw new ForbiddenError('You do not have access to this message');
    }

    await prisma.message.update({
      where: { id: messageId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    logger.info(`Message marked as read: ${messageId} by user ${userId}`);
  }

  /**
   * Mark all messages in a conversation as read
   */
  async markConversationAsRead(swapId: string, userId: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this conversation');
    }

    await prisma.message.updateMany({
      where: {
        swapId,
        senderId: { not: userId },
        isRead: false,
        isDeleted: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    logger.info(`Conversation marked as read: ${swapId} by user ${userId}`);
  }

  /**
   * Get unread message count for a user
   */
  async getUnreadCount(userId: string) {
    const count = await prisma.message.count({
      where: {
        swap: {
          OR: [{ initiatorId: userId }, { receiverId: userId }],
        },
        senderId: { not: userId },
        isRead: false,
        isDeleted: false,
      },
    });

    return count;
  }

  /**
   * Report a message
   */
  async reportMessage(
    messageId: string,
    userId: string,
    reason: string,
    description: string
  ) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        swap: true,
      },
    });

    if (!message) {
      throw new NotFoundError('Message not found');
    }

    // Verify user has access to this conversation
    if (
      message.swap.initiatorId !== userId &&
      message.swap.receiverId !== userId
    ) {
      throw new ForbiddenError('You do not have access to this message');
    }

    if (message.senderId === userId) {
      throw new BadRequestError('Cannot report your own message');
    }

    // Create admin log for the report
    await prisma.adminLog.create({
      data: {
        adminId: userId,
        action: 'CONTENT_MODERATED',
        targetType: 'Message',
        targetId: messageId,
        details: `Message reported: ${reason} - ${description}`,
      },
    });

    logger.warn(`Message reported: ${messageId} by user ${userId} - Reason: ${reason}`);
  }

  /**
   * Delete entire conversation (for one user)
   */
  async deleteConversation(swapId: string, userId: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this conversation');
    }

    // Soft delete all messages in the conversation
    await prisma.message.updateMany({
      where: { swapId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
      },
    });

    logger.info(`Conversation deleted: ${swapId} by user ${userId}`);
  }

  /**
   * Get message statistics for a swap
   */
  async getMessageStats(swapId: string, userId: string) {
    const swap = await prisma.swap.findUnique({
      where: { id: swapId },
    });

    if (!swap) {
      throw new NotFoundError('Swap not found');
    }

    if (swap.initiatorId !== userId && swap.receiverId !== userId) {
      throw new ForbiddenError('You do not have access to this conversation');
    }

    const [total, unread, sent, received] = await Promise.all([
      prisma.message.count({
        where: { swapId, isDeleted: false },
      }),
      prisma.message.count({
        where: {
          swapId,
          senderId: { not: userId },
          isRead: false,
          isDeleted: false,
        },
      }),
      prisma.message.count({
        where: { swapId, senderId: userId, isDeleted: false },
      }),
      prisma.message.count({
        where: { swapId, senderId: { not: userId }, isDeleted: false },
      }),
    ]);

    return {
      total,
      unread,
      sent,
      received,
    };
  }
}