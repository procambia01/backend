import type { NotificationDto } from '@/contracts';
import type { NotificationRoute, NotificationType, Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import { interpolate, MESSAGES, resolveLocale } from '@/i18n';
import { emitToUser } from '@/lib/realtime';
import { NotFoundError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { emailService } from './email.service';
import { pushService } from './push.service';

/** Single source of truth for where a notification type leads. Clients only read `route` + `entityId`. */
export const NOTIFICATION_ROUTES: Record<NotificationType, NotificationRoute> = {
  MATCH_FOUND: 'OFFER',
  SWAP_REQUEST: 'SWAP_DETAILS',
  SWAP_ACCEPTED: 'SWAP_DETAILS',
  SWAP_REJECTED: 'SWAP_DETAILS',
  SWAP_STARTED: 'SWAP_DETAILS',
  SWAP_CONFIRMED: 'SWAP_DETAILS',
  SWAP_COMPLETED: 'SWAP_DETAILS',
  SWAP_CANCELLED: 'SWAP_DETAILS',
  MEETUP_PROPOSED: 'MEETUP',
  MEETUP_ACCEPTED: 'MEETUP',
  MESSAGE_RECEIVED: 'CHAT',
  RATING_RECEIVED: 'SWAP_DETAILS',
  DISPUTE_OPENED: 'DISPUTE',
  DISPUTE_RESOLVED: 'DISPUTE',
  VERIFICATION_UPDATE: 'VERIFICATION',
  OFFER_BOOSTED: 'OFFER',
  OFFER_FEATURED: 'OFFER',
  OFFER_EXPIRING: 'OFFER',
  PAYMENT_SUCCESS: 'SERVICE_PAYMENT',
  PAYMENT_FAILED: 'SERVICE_PAYMENT',
  PLAN_EXPIRING: 'PLAN',
  PLAN_EXPIRED: 'PLAN',
  RATE_ALERT: 'RATE_ALERT',
  REFERRAL_UPDATE: 'REFERRALS',
  ACCOUNT_WARNING: 'PROFILE',
  LOGIN_ALERT: 'PROFILE',
  SYSTEM_ALERT: 'NOTIFICATIONS',
};

/** Types that are also e-mailed when the user allows it (security / money related). */
const EMAIL_TYPES = new Set<NotificationType>([
  'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PLAN_EXPIRING', 'PLAN_EXPIRED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED',
  'VERIFICATION_UPDATE', 'ACCOUNT_WARNING', 'SWAP_COMPLETED',
]);
/** Types never pushed to the device (noisy, or already visible in-app). */
const NO_PUSH = new Set<NotificationType>(['RATING_RECEIVED']);

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  /** Placeholder values for the template, e.g. { name, amount, pair }. */
  params?: Record<string, string | number>;
  entityId?: string | null;
  data?: Record<string, unknown>;
  /** Overrides the default route for this type. */
  route?: NotificationRoute;
  /** Prevents duplicates for once-only events (e.g. "swap:<id>:completed:<userId>"). */
  dedupeKey?: string;
}

export class NotificationService {
  private async render(type: NotificationType, locale: string, params: Record<string, string | number>) {
    const tpl = await prisma.notificationTemplate.findUnique({ where: { type_locale: { type, locale } } }).catch(() => null);
    if (tpl?.isActive) return { title: interpolate(tpl.titleTemplate, params), message: interpolate(tpl.bodyTemplate, params) };
    const t = MESSAGES[`notif.${type}.title`];
    const b = MESSAGES[`notif.${type}.body`];
    const l = resolveLocale(locale);
    return {
      title: interpolate(t?.[l] ?? type, params),
      message: interpolate(b?.[l] ?? '', params),
    };
  }

  /** Creates the in-app notification and fans out to realtime, push and (for some types) email. Never throws. */
  async notify(input: NotifyInput): Promise<string | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { email: true, name: true, languagePreference: true, receiveEmails: true, receivePush: true, notificationPreferences: true, deletedAt: true },
      });
      if (!user || user.deletedAt) return null;
      const prefs = (user.notificationPreferences ?? {}) as Record<string, boolean>;
      if (prefs[input.type] === false && input.type !== 'ACCOUNT_WARNING' && input.type !== 'LOGIN_ALERT') return null;

      if (input.dedupeKey) {
        const seen = await prisma.notification.findFirst({
          where: { userId: input.userId, dedupeKey: input.dedupeKey },
          select: { id: true },
        });
        if (seen) return seen.id;
      }

      const { title, message } = await this.render(input.type, user.languagePreference, { name: '', ...(input.params ?? {}) });
      const route = input.route ?? NOTIFICATION_ROUTES[input.type];
      const wantsEmail = EMAIL_TYPES.has(input.type) && user.receiveEmails;
      const wantsPush = user.receivePush && !NO_PUSH.has(input.type);

      const row = await prisma.notification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title,
          message,
          route,
          entityId: input.entityId ?? null,
          data: (input.data ?? {}) as Prisma.InputJsonValue,
          dedupeKey: input.dedupeKey ?? null,
          isPush: wantsPush,
          isEmail: wantsEmail,
        },
      });

      emitToUser(input.userId, 'notification:new', { id: row.id, type: row.type, title, message, route, entityId: row.entityId, createdAt: row.createdAt });
      emitToUser(input.userId, 'notification:unread', { count: await this.unreadCount(input.userId) });

      if (wantsPush) {
        void pushService.sendToUser(input.userId, { title, body: message, data: { notificationId: row.id, route, entityId: row.entityId } });
      }
      if (wantsEmail) void emailService.sendNotificationEmail(user.email, user.name, title, message, user.languagePreference);
      return row.id;
    } catch (error) {
      logger.error('notify failed', { type: input.type, message: (error as Error).message });
      return null;
    }
  }

  async notifyMany(userIds: string[], build: (userId: string) => Omit<NotifyInput, 'userId'>) {
    await Promise.all(userIds.map((id) => this.notify({ userId: id, ...build(id) })));
  }

  async list(userId: string, page: number, perPage: number, unreadOnly = false) {
    const where = { userId, ...(unreadOnly ? { isRead: false } : {}) };
    const [items, total, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      prisma.notification.count({ where }),
      this.unreadCount(userId),
    ]);
    return {
      total,
      unread,
      items: items.map((n): NotificationDto => ({
        id: n.id, type: n.type, title: n.title, message: n.message, route: n.route, entityId: n.entityId,
        isRead: n.isRead, createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  unreadCount(userId: string): Promise<number> {
    return prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(userId: string, id: string) {
    const r = await prisma.notification.updateMany({ where: { id, userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
    if (r.count === 0 && !(await prisma.notification.findFirst({ where: { id, userId }, select: { id: true } }))) throw new NotFoundError('Notification not found');
    emitToUser(userId, 'notification:unread', { count: await this.unreadCount(userId) });
  }

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
    emitToUser(userId, 'notification:unread', { count: 0 });
  }

  async remove(userId: string, id: string) {
    const r = await prisma.notification.deleteMany({ where: { id, userId } });
    if (r.count === 0) throw new NotFoundError('Notification not found');
  }

  async purgeOld(days = 90) {
    const r = await prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86_400_000) }, isRead: true } });
    return r.count;
  }
}

export const notificationService = new NotificationService();
