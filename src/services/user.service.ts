import type { Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import type { EntitlementsDto } from '@/contracts';
import { effectivePlan } from '@/lib/entitlements';
import { fromMinor } from '@/lib/money';
import { toGeoPoint, toPublicArea, isValidLatLng } from '@/lib/geo';
import { toMe, toPublicUser } from '@/presenters/user.presenter';
import { BadRequestError, ConflictError, NotFoundError, UserNotFoundError, ValidationError } from '@/utils/error.util';
import { currencyService } from './currency.service';
import { limitService } from './limit.service';
import { sessionService } from './session.service';
import { storageService } from './storage.service';
import { IMAGE_UPLOAD_POLICY, UploadValidationError, validateUpload } from '@/lib/file-signature';
import { UploadInvalidError } from '@/utils/error.util';
import { stripe } from './stripe.client';
import { auditService } from './audit.service';
import { logActivity } from './activity.service';

export interface ProfileUpdate {
  name?: string;
  bio?: string;
  country?: string;
  city?: string;
  languagePreference?: string;
  timezone?: string;
  preferredCurrencies?: string[];
}

export interface PreferencesUpdate {
  darkMode?: boolean;
  receiveEmails?: boolean;
  receiveSMS?: boolean;
  receivePush?: boolean;
  notificationPreferences?: Record<string, boolean>;
  preferredMeetingPlaces?: string[];
}

export class UserService {
  async updateProfile(userId: string, input: ProfileUpdate) {
    if (input.preferredCurrencies) {
      for (const c of input.preferredCurrencies) await currencyService.get(c);
    }
    const user = await prisma.user.update({ where: { id: userId }, data: { ...input } as Prisma.UserUpdateInput });
    await logActivity(userId, 'PROFILE_UPDATED', 'Profile updated');
    return toMe(user);
  }

  async updatePreferences(userId: string, input: PreferencesUpdate) {
    const { notificationPreferences, ...rest } = input;
    const user = await prisma.user.update({ where: { id: userId }, data: { ...rest, ...(notificationPreferences ? { notificationPreferences: notificationPreferences as Prisma.InputJsonValue } : {}) } });
    return toMe(user);
  }

  /**
   * Stores the exact position privately and derives the coarse public area.
   * Neither value is ever shown to other users as exact coordinates.
   */
  async setLocation(userId: string, input: { latitude: number; longitude: number; city: string; country: string; state?: string }) {
    const p = { latitude: input.latitude, longitude: input.longitude };
    if (!isValidLatLng(p)) throw new ValidationError('Invalid coordinates');
    await prisma.user.update({
      where: { id: userId },
      data: { privateLocation: toGeoPoint(p), areaCenter: toPublicArea(p, userId), city: input.city, country: input.country, state: input.state, lastLocationUpdate: new Date() },
    });
    return { city: input.city, country: input.country };
  }

  async setAvatar(userId: string, file: { buffer: Buffer; mimetype: string }) {
    try {
      validateUpload(file.buffer, file.mimetype, IMAGE_UPLOAD_POLICY);
    } catch (e) {
      if (e instanceof UploadValidationError) throw new UploadInvalidError(e.message);
      throw e;
    }
    const url = await storageService.putAvatar(file.buffer, userId);
    await prisma.user.update({ where: { id: userId }, data: { image: url } });
    return { image: url };
  }

  async publicProfile(viewerId: string | undefined, id: string) {
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u || u.deletedAt || !u.isActive || u.isBanned) throw new UserNotFoundError();
    if (viewerId && viewerId !== id) {
      const blocked = await prisma.blockedUser.count({ where: { OR: [{ blockerId: viewerId, blockedId: id }, { blockerId: id, blockedId: viewerId }] } });
      if (blocked) throw new UserNotFoundError();
    }
    const [activeOffers, favorite] = await Promise.all([
      prisma.swapOffer.count({ where: { userId: id, status: 'ACTIVE', visibility: 'PUBLIC', availableUntil: { gt: new Date() } } }),
      viewerId ? prisma.favoriteUser.count({ where: { userId: viewerId, favoriteId: id } }) : 0,
    ]);
    return { ...toPublicUser(u), bio: u.bio, activeOffers, isFavorite: favorite > 0 };
  }

  async entitlements(userId: string): Promise<EntitlementsDto> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const limits = await limitService.forUserRecord(user);
    const unit = await currencyService.minorUnit(limits.limitCurrency);
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const [activeOffers, activeSwaps, rateAlerts, boostsThisMonth] = await Promise.all([
      prisma.swapOffer.count({ where: { userId, status: { in: ['ACTIVE', 'PAUSED'] } } }),
      prisma.swap.count({ where: { OR: [{ initiatorId: userId }, { receiverId: userId }], status: { in: ['PENDING', 'AGREED', 'IN_PROGRESS', 'CONFIRMING', 'DISPUTED'] } } }),
      prisma.rateAlert.count({ where: { userId, isActive: true } }),
      prisma.payment.count({ where: { userId, kind: 'BOOST', status: { in: ['SUCCEEDED', 'PROCESSING', 'PARTIALLY_REFUNDED'] }, createdAt: { gte: start } } }),
    ]);
    return {
      planTier: effectivePlan(user),
      policyKey: limits.key,
      limits: {
        maxSwap: fromMinor(limits.maxSwapMinor, unit), daily: fromMinor(limits.dailyMinor, unit), weekly: fromMinor(limits.weeklyMinor, unit), monthly: fromMinor(limits.monthlyMinor, unit),
        limitCurrency: limits.limitCurrency, maxActiveOffers: limits.maxActiveOffers, maxActiveSwaps: limits.maxActiveSwaps, maxRateAlerts: limits.maxRateAlerts,
        apiCallsPerMonth: limits.apiCallsPerMonth, maxBoostPurchasesMonth: limits.maxBoostPurchasesMonth, maxTeamMembers: limits.maxTeamMembers,
      },
      features: {
        advancedSearch: limits.advancedSearch, priorityMatching: limits.priorityMatching, advancedAnalytics: limits.advancedAnalytics,
        premiumBadge: limits.premiumBadge, prioritySupport: limits.prioritySupport, apiAccess: limits.apiAccess,
      },
      usage: { activeOffers, activeSwaps, rateAlerts, boostsThisMonth },
    };
  }

  async activity(userId: string, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      prisma.activityLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      prisma.activityLog.count({ where: { userId } }),
    ]);
    return { total, items: rows.map((a) => ({ id: a.id, action: a.action, description: a.description, createdAt: a.createdAt.toISOString() })) };
  }

  // ───────────── blocking & favourites ─────────────

  async block(userId: string, targetId: string, reason?: string) {
    if (userId === targetId) throw new BadRequestError('You cannot block yourself');
    if (!(await prisma.user.count({ where: { id: targetId } }))) throw new UserNotFoundError();
    try {
      await prisma.blockedUser.create({ data: { blockerId: userId, blockedId: targetId, reason } });
    } catch {
      throw new ConflictError('User is already blocked');
    }
    await prisma.favoriteUser.deleteMany({ where: { OR: [{ userId, favoriteId: targetId }, { userId: targetId, favoriteId: userId }] } });
  }
  async unblock(userId: string, targetId: string) {
    await prisma.blockedUser.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
  }
  async blocked(userId: string) {
    const rows = await prisma.blockedUser.findMany({ where: { blockerId: userId }, include: { blocked: true }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ ...toPublicUser(r.blocked), blockedAt: r.createdAt.toISOString() }));
  }
  async favorite(userId: string, targetId: string, notes?: string) {
    if (userId === targetId) throw new BadRequestError('You cannot favourite yourself');
    if ((await prisma.blockedUser.count({ where: { OR: [{ blockerId: userId, blockedId: targetId }, { blockerId: targetId, blockedId: userId }] } })) > 0) throw new NotFoundError('User not found');
    await prisma.favoriteUser.upsert({ where: { userId_favoriteId: { userId, favoriteId: targetId } }, create: { userId, favoriteId: targetId, notes }, update: { notes } });
  }
  async unfavorite(userId: string, targetId: string) {
    await prisma.favoriteUser.deleteMany({ where: { userId, favoriteId: targetId } });
  }
  async favorites(userId: string) {
    const rows = await prisma.favoriteUser.findMany({ where: { userId }, include: { favorite: true }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => ({ ...toPublicUser(r.favorite), notes: r.notes }));
  }

  // ───────────── push tokens ─────────────

  async registerPushToken(userId: string, token: string, platform: string, deviceId?: string) {
    await prisma.pushToken.upsert({ where: { token }, create: { userId, token, platform, deviceId }, update: { userId, platform, deviceId, isActive: true, lastUsedAt: new Date() } });
  }
  async removePushToken(userId: string, token: string) {
    await prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  // ───────────── account deletion ─────────────

  /** Soft-deletes and anonymises the account. Refused while swaps are in flight. */
  async deleteAccount(userId: string) {
    const live = await prisma.swap.count({ where: { OR: [{ initiatorId: userId }, { receiverId: userId }], status: { in: ['PENDING', 'AGREED', 'IN_PROGRESS', 'CONFIRMING', 'DISPUTED'] } } });
    if (live) throw new ConflictError('Finish or cancel your active swaps before deleting your account');
    await prisma.swapOffer.updateMany({ where: { userId, status: { in: ['ACTIVE', 'PAUSED'] }, reservedMinor: 0n }, data: { status: 'CANCELLED' } });

    const subs = await prisma.subscription.findMany({ where: { userId, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } } });
    for (const s of subs) await stripe().subscriptions.cancel(s.stripeSubscriptionId).catch(() => undefined);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          email: `deleted+${userId}@cashmouver.invalid`, name: 'Deleted user', image: null, bio: null, phone: null, phoneVerified: false,
          passwordHash: null, isActive: false, deletedAt: new Date(), privateLocation: null, areaCenter: null, twoFactorEnabled: false,
          tokenVersion: { increment: 1 },
        },
      }),
      prisma.verifiedPhone.deleteMany({ where: { userId } }),
      prisma.twoFactorSecret.deleteMany({ where: { userId } }),
      prisma.pushToken.deleteMany({ where: { userId } }),
      prisma.apiKey.updateMany({ where: { userId }, data: { isActive: false, revokedAt: new Date() } }),
      prisma.verificationCase.updateMany({ where: { userId }, data: { retainUntil: new Date() } }),
    ]);
    await sessionService.revokeAll(userId, 'ACCOUNT_DELETED');
    await auditService.record({ actorId: userId, action: 'account.deleted', targetType: 'User', targetId: userId });
  }
}

export const userService = new UserService();
