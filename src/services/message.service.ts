import type { Message, Swap } from '@prisma/client';
import { prisma } from '@/config/database';
import type { ConversationDto, MessageDto } from '@/contracts';
import { emitToUser } from '@/lib/realtime';
import { IMAGE_UPLOAD_POLICY, UploadValidationError, validateUpload } from '@/lib/file-signature';
import { sha256Hex } from '@/lib/crypto';
import { roleOf } from '@/presenters/swap.presenter';
import { toPublicUser } from '@/presenters/user.presenter';
import { ForbiddenError, InvalidStateError, NotFoundError, UploadInvalidError, ValidationError } from '@/utils/error.util';
import { notificationService } from './notification.service';
import { storageService } from './storage.service';

const EDIT_WINDOW_MS = 5 * 60_000;
const CLOSED_CHAT_GRACE_MS = 3 * 86_400_000;
const MAX_ATTACHMENTS = 3;

/** Strips control characters; content is rendered as text by every client (never HTML). */
export const cleanText = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();

const attachmentPath = (id: string, i: number) => `/api/v1/messages/${id}/attachments/${i}`;

export const toMessageDto = (m: Message): MessageDto => ({
  id: m.id,
  swapId: m.swapId,
  senderId: m.senderId,
  content: m.isDeleted ? '' : m.content,
  messageType: m.messageType,
  attachments: m.isDeleted ? [] : m.attachments.map((_, i) => attachmentPath(m.id, i)),
  readAt: m.readAt?.toISOString() ?? null,
  createdAt: m.createdAt.toISOString(),
  isDeleted: m.isDeleted,
  isEdited: m.isEdited,
});

/**
 * The ONLY place messages are created. Other services (swap, dispute…) call
 * into this class instead of writing to the collection themselves.
 */
export class MessageService {
  private async participantSwap(swapId: string, userId: string): Promise<Swap> {
    const swap = await prisma.swap.findUnique({ where: { id: swapId } });
    if (!swap || !roleOf(swap, userId)) throw new NotFoundError('Conversation not found');
    return swap;
  }

  private async assertOpen(swap: Swap, senderId: string): Promise<string> {
    const other = swap.initiatorId === senderId ? swap.receiverId : swap.initiatorId;
    const blocked = await prisma.blockedUser.count({ where: { OR: [{ blockerId: senderId, blockedId: other }, { blockerId: other, blockedId: senderId }] } });
    if (blocked) throw new ForbiddenError('You cannot message this user');
    if (['COMPLETED', 'CANCELLED'].includes(swap.status)) {
      const closedAt = swap.completedAt ?? swap.cancelledAt ?? swap.updatedAt;
      if (Date.now() - closedAt.getTime() > CLOSED_CHAT_GRACE_MS) throw new InvalidStateError('This conversation is closed');
    }
    return other;
  }

  private async deliver(m: Message, swap: Swap, receiverId: string, senderId: string) {
    const dto = toMessageDto(m);
    emitToUser(receiverId, 'message:new', dto);
    emitToUser(senderId, 'message:sent', dto);
    emitToUser(receiverId, 'message:unread', { swapId: swap.id, total: await this.unreadTotal(receiverId) });
    // One notification per 5 minutes per conversation, not one per message.
    const bucket = Math.floor(Date.now() / 300_000);
    const sender = await prisma.user.findUnique({ where: { id: senderId }, select: { name: true } });
    await notificationService.notify({ userId: receiverId, type: 'MESSAGE_RECEIVED', entityId: swap.id, params: { name: sender?.name.split(' ')[0] ?? '' }, dedupeKey: `msg:${swap.id}:${receiverId}:${bucket}` });
  }

  async send(senderId: string, swapId: string, content: string): Promise<MessageDto> {
    const swap = await this.participantSwap(swapId, senderId);
    const receiverId = await this.assertOpen(swap, senderId);
    const text = cleanText(content);
    if (!text) throw new ValidationError('Message cannot be empty');
    const m = await prisma.message.create({ data: { swapId, senderId, content: text.slice(0, 2000) } });
    await this.deliver(m, swap, receiverId, senderId);
    return toMessageDto(m);
  }

  /** Used when the swap request itself carries an introductory message. */
  async createSystemOrFirst(swapId: string, senderId: string, content: string): Promise<void> {
    const text = cleanText(content);
    if (!text) return;
    await prisma.message.create({ data: { swapId, senderId, content: text.slice(0, 2000) } });
  }

  /** Image attachments only, validated by magic bytes, stored privately. */
  async sendImage(senderId: string, swapId: string, file: { buffer: Buffer; mimetype: string }, caption?: string): Promise<MessageDto> {
    const swap = await this.participantSwap(swapId, senderId);
    const receiverId = await this.assertOpen(swap, senderId);
    let mime;
    try {
      mime = validateUpload(file.buffer, file.mimetype, IMAGE_UPLOAD_POLICY);
    } catch (e) {
      if (e instanceof UploadValidationError) throw new UploadInvalidError(e.message);
      throw e;
    }
    const key = await storageService.putPrivate(file.buffer, mime, `chat/${swapId}`, `${senderId}_${Date.now()}_${sha256Hex(file.buffer).slice(0, 10)}`);
    const m = await prisma.message.create({ data: { swapId, senderId, content: cleanText(caption ?? '').slice(0, 500), messageType: 'IMAGE', attachments: [key].slice(0, MAX_ATTACHMENTS) } });
    await this.deliver(m, swap, receiverId, senderId);
    return toMessageDto(m);
  }

  async attachmentUrl(userId: string, messageId: string, index: number) {
    const m = await prisma.message.findUnique({ where: { id: messageId } });
    if (!m) throw new NotFoundError('Attachment not found');
    await this.participantSwap(m.swapId, userId);
    const key = m.attachments[index];
    if (!key || m.isDeleted) throw new NotFoundError('Attachment not found');
    return { url: storageService.signedUrl(key, 120) };
  }

  async list(userId: string, swapId: string, page: number, perPage: number) {
    await this.participantSwap(swapId, userId);
    const where = { swapId };
    const [rows, total] = await Promise.all([
      prisma.message.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      prisma.message.count({ where }),
    ]);
    return { items: rows.reverse().map(toMessageDto), total };
  }

  /** Read receipts: marks everything the OTHER party sent as read. */
  async markRead(userId: string, swapId: string): Promise<number> {
    const swap = await this.participantSwap(swapId, userId);
    const now = new Date();
    const r = await prisma.message.updateMany({ where: { swapId, senderId: { not: userId }, readAt: null }, data: { readAt: now } });
    if (r.count > 0) {
      const other = swap.initiatorId === userId ? swap.receiverId : swap.initiatorId;
      emitToUser(other, 'message:read', { swapId, readerId: userId, readAt: now.toISOString() });
      emitToUser(userId, 'message:unread', { swapId, total: await this.unreadTotal(userId) });
    }
    return r.count;
  }

  async unreadTotal(userId: string): Promise<number> {
    return prisma.message.count({
      where: { readAt: null, isDeleted: false, senderId: { not: userId }, swap: { OR: [{ initiatorId: userId }, { receiverId: userId }] } },
    });
  }

  async conversations(userId: string, page: number, perPage: number): Promise<{ items: ConversationDto[]; total: number }> {
    const where = { OR: [{ initiatorId: userId }, { receiverId: userId }], messages: { some: {} } };
    const [swaps, total] = await Promise.all([
      prisma.swap.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      prisma.swap.count({ where }),
    ]);
    const items = await Promise.all(
      swaps.map(async (s) => {
        const otherId = s.initiatorId === userId ? s.receiverId : s.initiatorId;
        const [other, last, unread] = await Promise.all([
          prisma.user.findUniqueOrThrow({ where: { id: otherId } }),
          prisma.message.findFirst({ where: { swapId: s.id }, orderBy: { createdAt: 'desc' } }),
          prisma.message.count({ where: { swapId: s.id, senderId: { not: userId }, readAt: null, isDeleted: false } }),
        ]);
        return { swapId: s.id, swapStatus: s.status, other: toPublicUser(other), lastMessage: last ? toMessageDto(last) : null, unreadCount: unread };
      })
    );
    return { items, total };
  }

  async edit(userId: string, messageId: string, content: string): Promise<MessageDto> {
    const m = await prisma.message.findUnique({ where: { id: messageId } });
    if (!m || m.senderId !== userId) throw new NotFoundError('Message not found');
    if (m.messageType !== 'TEXT' || m.isDeleted) throw new InvalidStateError('This message cannot be edited');
    if (Date.now() - m.createdAt.getTime() > EDIT_WINDOW_MS) throw new InvalidStateError('Messages can only be edited for 5 minutes');
    const text = cleanText(content);
    if (!text) throw new ValidationError('Message cannot be empty');
    const updated = await prisma.message.update({ where: { id: messageId }, data: { content: text, isEdited: true, editedAt: new Date() } });
    const swap = await prisma.swap.findUniqueOrThrow({ where: { id: m.swapId } });
    emitToUser(swap.initiatorId === userId ? swap.receiverId : swap.initiatorId, 'message:updated', toMessageDto(updated));
    return toMessageDto(updated);
  }

  async remove(userId: string, messageId: string): Promise<void> {
    const m = await prisma.message.findUnique({ where: { id: messageId } });
    if (!m || m.senderId !== userId) throw new NotFoundError('Message not found');
    await prisma.message.update({ where: { id: messageId }, data: { isDeleted: true, deletedAt: new Date() } });
    const swap = await prisma.swap.findUniqueOrThrow({ where: { id: m.swapId } });
    emitToUser(swap.initiatorId === userId ? swap.receiverId : swap.initiatorId, 'message:deleted', { id: messageId, swapId: m.swapId });
  }

  async report(userId: string, messageId: string, reason: string): Promise<void> {
    const m = await prisma.message.findUnique({ where: { id: messageId } });
    if (!m) throw new NotFoundError('Message not found');
    await this.participantSwap(m.swapId, userId);
    if (m.senderId === userId) throw new ForbiddenError('You cannot report your own message');
    try {
      await prisma.messageReport.create({ data: { messageId, reporterId: userId, reason: cleanText(reason).slice(0, 500) } });
    } catch {
      /* already reported by this user — idempotent */
    }
  }
}

export const messageService = new MessageService();
