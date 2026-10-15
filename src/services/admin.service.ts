import type { BillingInterval, FeaturedPlacement, PlanTier, Prisma, ProductKind, UserRole } from '@prisma/client';
import { prisma } from '@/config/database';
import { toMe } from '@/presenters/user.presenter';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/utils/error.util';
import { auditService } from './audit.service';
import { currencyService } from './currency.service';
import { ledgerService } from './ledger.service';
import { notificationService } from './notification.service';
import { sessionService } from './session.service';
import { toServiceProductDto } from '@/presenters/billing.presenter';
import { toMinorService } from './_admin-helpers';

const ROLE_LEVEL: Record<UserRole, number> = { USER: 1, STAFF: 2, ADMIN: 3, SUPER_ADMIN: 4 };
const requireReason = (reason?: string) => {
  if (!reason || reason.trim().length < 5) throw new BadRequestError('A reason of at least 5 characters is required');
  return reason.trim();
};

export interface ProductInput {
  code: string;
  kind: ProductKind;
  name: string;
  description?: string;
  amountMinor: number;
  currency: string;
  interval?: BillingInterval;
  durationHours?: number;
  planTier?: PlanTier;
  placement?: FeaturedPlacement;
  trialDays?: number;
  features?: string[];
  config?: Record<string, unknown>;
  isActive?: boolean;
  sortOrder?: number;
}

export class AdminService {
  // ───────────── users ─────────────

  async listUsers(q: { search?: string; role?: UserRole; status?: 'banned' | 'suspended' | 'active'; page: number; perPage: number }) {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (q.search) where.OR = [{ email: { contains: q.search, mode: 'insensitive' } }, { name: { contains: q.search, mode: 'insensitive' } }];
    if (q.role) where.role = q.role;
    if (q.status === 'banned') where.isBanned = true;
    if (q.status === 'suspended') where.isSuspended = true;
    if (q.status === 'active') Object.assign(where, { isBanned: false, isSuspended: false });
    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.perPage, take: q.perPage }),
      prisma.user.count({ where }),
    ]);
    return { total, items: rows.map((u) => ({ ...toMe(u), isBanned: u.isBanned, isSuspended: u.isSuspended, tradingRestricted: u.tradingRestricted, lastLocationUpdate: u.lastLocationUpdate?.toISOString() ?? null })) };
  }

  async getUser(id: string) {
    const u = await prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundError('User not found');
    const [swaps, offers, disputes, flags] = await Promise.all([
      prisma.swap.count({ where: { OR: [{ initiatorId: id }, { receiverId: id }] } }),
      prisma.swapOffer.count({ where: { userId: id } }),
      prisma.dispute.count({ where: { OR: [{ reporterId: id }, { againstId: id }] } }),
      prisma.riskFlag.count({ where: { userId: id, status: { in: ['OPEN', 'REVIEWING'] } } }),
    ]);
    return { ...toMe(u), isBanned: u.isBanned, banReason: u.banReason, isSuspended: u.isSuspended, suspensionReason: u.suspensionReason, tradingRestricted: u.tradingRestricted, counts: { swaps, offers, disputes, openRiskFlags: flags } };
  }

  /** Staff may only act on users strictly below their own role. */
  private async target(actorId: string, actorRole: UserRole, targetId: string) {
    if (actorId === targetId) throw new ForbiddenError('You cannot perform this action on yourself');
    const t = await prisma.user.findUnique({ where: { id: targetId } });
    if (!t) throw new NotFoundError('User not found');
    if (ROLE_LEVEL[t.role] >= ROLE_LEVEL[actorRole]) throw new ForbiddenError('You cannot act on a user with an equal or higher role');
    return t;
  }

  async ban(actor: { id: string; role: UserRole }, targetId: string, reason: string, until?: Date) {
    reason = requireReason(reason);
    const t = await this.target(actor.id, actor.role, targetId);
    await prisma.user.update({ where: { id: targetId }, data: { isBanned: true, banReason: reason, bannedAt: new Date(), bannedBy: actor.id, banExpiry: until ?? null, tokenVersion: { increment: 1 } } });
    await sessionService.revokeAll(targetId, 'BANNED');
    await prisma.swapOffer.updateMany({ where: { userId: targetId, status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    await auditService.record({ actorId: actor.id, actorRole: actor.role, action: 'user.ban', targetType: 'User', targetId, before: { isBanned: t.isBanned }, after: { isBanned: true, until }, reason });
  }
  async unban(actor: { id: string; role: UserRole }, targetId: string, reason: string) {
    reason = requireReason(reason);
    await this.target(actor.id, actor.role, targetId);
    await prisma.user.update({ where: { id: targetId }, data: { isBanned: false, banReason: null, bannedAt: null, banExpiry: null } });
    await auditService.record({ actorId: actor.id, actorRole: actor.role, action: 'user.unban', targetType: 'User', targetId, reason });
  }
  async suspend(actor: { id: string; role: UserRole }, targetId: string, reason: string, until?: Date) {
    reason = requireReason(reason);
    await this.target(actor.id, actor.role, targetId);
    await prisma.user.update({ where: { id: targetId }, data: { isSuspended: true, suspensionReason: reason, suspendedAt: new Date(), suspendedBy: actor.id, suspensionExpiry: until ?? null } });
    await auditService.record({ actorId: actor.id, actorRole: actor.role, action: 'user.suspend', targetType: 'User', targetId, after: { until }, reason });
    await notificationService.notify({ userId: targetId, type: 'ACCOUNT_WARNING', params: { message: 'Your account has been suspended.' }, dedupeKey: `suspend:${targetId}:${Date.now()}` });
  }
  async unsuspend(actor: { id: string; role: UserRole }, targetId: string, reason: string) {
    reason = requireReason(reason);
    await this.target(actor.id, actor.role, targetId);
    await prisma.user.update({ where: { id: targetId }, data: { isSuspended: false, suspensionReason: null, suspendedAt: null, suspensionExpiry: null } });
    await auditService.record({ actorId: actor.id, actorRole: actor.role, action: 'user.unsuspend', targetType: 'User', targetId, reason });
  }
  async setTradingRestricted(actor: { id: string; role: UserRole }, targetId: string, restricted: boolean, reason: string) {
    reason = requireReason(reason);
    await this.target(actor.id, actor.role, targetId);
    await prisma.user.update({ where: { id: targetId }, data: { tradingRestricted: restricted } });
    await auditService.record({ actorId: actor.id, actorRole: actor.role, action: restricted ? 'user.restrict_trading' : 'user.allow_trading', targetType: 'User', targetId, reason });
  }
  /** Only SUPER_ADMIN, never on self, never promotes above own level, never removes the last super admin. */
  async setRole(actor: { id: string; role: UserRole }, targetId: string, role: UserRole, reason: string) {
    reason = requireReason(reason);
    if (actor.role !== 'SUPER_ADMIN') throw new ForbiddenError('Only a super admin can change roles');
    if (actor.id === targetId) throw new ForbiddenError('You cannot change your own role');
    const t = await prisma.user.findUnique({ where: { id: targetId } });
    if (!t) throw new NotFoundError('User not found');
    if (t.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN' && (await prisma.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })) <= 1) {
      throw new ConflictError('Cannot remove the last super admin');
    }
    await prisma.user.update({ where: { id: targetId }, data: { role, tokenVersion: { increment: 1 } } });
    await sessionService.revokeAll(targetId, 'ROLE_CHANGED');
    await auditService.record({ actorId: actor.id, actorRole: actor.role, action: 'user.role_change', targetType: 'User', targetId, before: { role: t.role }, after: { role }, reason });
  }

  // ───────────── products & pricing ─────────────

  async listProducts() {
    const units = await currencyService.unitMap();
    return (await prisma.serviceProduct.findMany({ orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] })).map((p) => ({ ...toServiceProductDto(p, units), amountMinor: p.amountMinor, id: p.id, isActive: p.isActive, sortOrder: p.sortOrder, config: p.config }));
  }

  private async validateProduct(i: ProductInput) {
    const cur = await currencyService.assertActive(i.currency);
    toMinorService(i.amountMinor, cur.minorUnit);
    if (!Number.isSafeInteger(i.amountMinor) || i.amountMinor <= 0) throw new ValidationError('amountMinor must be a positive integer');
    if (['PREMIUM_PLAN', 'BUSINESS_PLAN', 'API_PLAN'].includes(i.kind) && (!i.interval || i.interval === 'ONE_TIME')) throw new ValidationError('Plan products need a MONTH or YEAR interval');
    if (['PREMIUM_PLAN', 'BUSINESS_PLAN'].includes(i.kind) && !i.planTier) throw new ValidationError('Plan products need a planTier');
    if (['BOOST', 'FEATURED', 'ADVERTISING'].includes(i.kind) && !i.durationHours) throw new ValidationError('This product needs durationHours');
    if (i.kind === 'FEATURED' && !i.placement) throw new ValidationError('Featured products need a placement');
  }

  /** Price changes affect only future purchases; past Payments and ledger rows are immutable. */
  async upsertProduct(actorId: string, i: ProductInput, reason?: string) {
    await this.validateProduct(i);
    const code = i.code.toUpperCase();
    const before = await prisma.serviceProduct.findUnique({ where: { code } });
    const data = {
      kind: i.kind, name: i.name, description: i.description, amountMinor: i.amountMinor, currency: i.currency.toUpperCase(), interval: i.interval ?? 'ONE_TIME',
      durationHours: i.durationHours, planTier: i.planTier, placement: i.placement, trialDays: i.trialDays ?? 0, features: i.features ?? [],
      config: (i.config ?? undefined) as Prisma.InputJsonValue | undefined, isActive: i.isActive ?? true, sortOrder: i.sortOrder ?? 100,
    };
    const row = await prisma.serviceProduct.upsert({ where: { code }, create: { code, ...data }, update: data });
    await auditService.record({ actorId, action: before ? 'product.update' : 'product.create', targetType: 'ServiceProduct', targetId: row.id, before: before ? { amountMinor: before.amountMinor, currency: before.currency, isActive: before.isActive } : undefined, after: { amountMinor: row.amountMinor, currency: row.currency, isActive: row.isActive }, reason });
    return toServiceProductDto(row, await currencyService.unitMap());
  }

  async setProductActive(actorId: string, code: string, isActive: boolean, reason?: string) {
    const p = await prisma.serviceProduct.findUnique({ where: { code } });
    if (!p) throw new NotFoundError('Product not found');
    await prisma.serviceProduct.update({ where: { id: p.id }, data: { isActive } });
    await auditService.record({ actorId, action: isActive ? 'product.activate' : 'product.deactivate', targetType: 'ServiceProduct', targetId: p.id, reason });
  }

  // ───────────── limit policies ─────────────

  async listLimitPolicies() {
    return prisma.limitPolicy.findMany({ orderBy: { key: 'asc' } });
  }

  async upsertLimitPolicy(actorId: string, key: string, input: Record<string, unknown>, reason?: string) {
    const before = await prisma.limitPolicy.findUnique({ where: { key } });
    const big = (v: unknown, name: string) => {
      try {
        return BigInt(v as string | number);
      } catch {
        throw new ValidationError(`${name} must be an integer`);
      }
    };
    const data = {
      name: String(input.name ?? key), limitCurrency: String(input.limitCurrency ?? 'EUR').toUpperCase(),
      maxSwapMinor: big(input.maxSwapMinor, 'maxSwapMinor'), dailyMinor: big(input.dailyMinor, 'dailyMinor'), weeklyMinor: big(input.weeklyMinor, 'weeklyMinor'), monthlyMinor: big(input.monthlyMinor, 'monthlyMinor'),
      maxActiveOffers: Number(input.maxActiveOffers), maxActiveSwaps: Number(input.maxActiveSwaps), maxRateAlerts: Number(input.maxRateAlerts), apiCallsPerMonth: Number(input.apiCallsPerMonth ?? 0),
      maxBoostPurchasesMonth: Number(input.maxBoostPurchasesMonth), maxTeamMembers: Number(input.maxTeamMembers ?? 0),
      advancedSearch: !!input.advancedSearch, priorityMatching: !!input.priorityMatching, advancedAnalytics: !!input.advancedAnalytics, premiumBadge: !!input.premiumBadge, prioritySupport: !!input.prioritySupport, apiAccess: !!input.apiAccess,
      updatedBy: actorId,
    };
    for (const k of ['maxActiveOffers', 'maxActiveSwaps', 'maxRateAlerts', 'apiCallsPerMonth', 'maxBoostPurchasesMonth', 'maxTeamMembers'] as const) {
      if (!Number.isInteger(data[k]) || data[k] < 0) throw new ValidationError(`${k} must be a non-negative integer`);
    }
    await currencyService.get(data.limitCurrency);
    const row = await prisma.limitPolicy.upsert({ where: { key }, create: { key, ...data }, update: data });
    await auditService.record({ actorId, action: 'limits.update', targetType: 'LimitPolicy', targetId: row.id, before: before ? JSON.parse(JSON.stringify(before, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) : undefined, after: JSON.parse(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))), reason });
    return row;
  }

  // ───────────── referral rules & notification templates ─────────────

  async listReferralRules() {
    return prisma.referralRule.findMany({ orderBy: { code: 'asc' } });
  }
  async upsertReferralRule(actorId: string, input: { code: string; name: string; qualifyingAction: 'FIRST_COMPLETED_SWAP' | 'VERIFIED_AND_SWAP' | 'PAID_PLAN_PURCHASE'; minCompletedSwaps?: number; rewardType?: 'FIXED' | 'PERCENT_OF_SERVICE_REVENUE'; rewardMinor?: number; percentBps?: number; currency?: string; isPartnerRule?: boolean; monthlyCapPerReferrer?: number; lifetimeCapPerReferrer?: number; holdDays?: number; isActive?: boolean }, reason?: string) {
    const code = input.code.toUpperCase();
    const before = await prisma.referralRule.findUnique({ where: { code } });
    const { code: _c, ...rest } = input;
    const row = await prisma.referralRule.upsert({ where: { code }, create: { code, ...rest }, update: rest });
    await auditService.record({ actorId, action: 'referral_rule.upsert', targetType: 'ReferralRule', targetId: row.id, before, after: row, reason });
    return row;
  }
  async setPartner(actorId: string, userId: string, isPartner: boolean) {
    const c = await prisma.referralCode.findUnique({ where: { userId } });
    if (!c) throw new NotFoundError('Referral code not found');
    await prisma.referralCode.update({ where: { userId }, data: { isPartner } });
    await auditService.record({ actorId, action: 'referral.partner_flag', targetType: 'ReferralCode', targetId: c.id, after: { isPartner } });
  }
  async listTemplates() {
    return prisma.notificationTemplate.findMany({ orderBy: [{ type: 'asc' }, { locale: 'asc' }] });
  }
  async upsertTemplate(actorId: string, input: { type: Prisma.NotificationTemplateCreateInput['type']; locale: string; titleTemplate: string; bodyTemplate: string; isActive?: boolean }) {
    const row = await prisma.notificationTemplate.upsert({
      where: { type_locale: { type: input.type, locale: input.locale } },
      create: { ...input, updatedBy: actorId },
      update: { titleTemplate: input.titleTemplate, bodyTemplate: input.bodyTemplate, isActive: input.isActive ?? true, updatedBy: actorId },
    });
    await auditService.record({ actorId, action: 'notification_template.upsert', targetType: 'NotificationTemplate', targetId: row.id, after: { type: row.type, locale: row.locale } });
    return row;
  }

  // ───────────── money views (read-only) ─────────────

  async listPayments(q: { status?: string; userId?: string; kind?: ProductKind; page: number; perPage: number }) {
    const where: Prisma.PaymentWhereInput = { ...(q.status ? { status: q.status as Prisma.PaymentWhereInput['status'] } : {}), ...(q.userId ? { userId: q.userId } : {}), ...(q.kind ? { kind: q.kind } : {}) };
    const [items, total] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.perPage, take: q.perPage }),
      prisma.payment.count({ where }),
    ]);
    return { items, total };
  }

  async listWebhookEvents(page: number, perPage: number, status?: string) {
    const where = status ? { status: status as Prisma.StripeWebhookEventWhereInput['status'] } : {};
    const [items, total] = await Promise.all([
      prisma.stripeWebhookEvent.findMany({ where, orderBy: { receivedAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      prisma.stripeWebhookEvent.count({ where }),
    ]);
    return { items, total };
  }

  async auditLogs(q: { actorId?: string; action?: string; targetType?: string; page: number; perPage: number }) {
    const where: Prisma.AuditLogWhereInput = { ...(q.actorId ? { actorId: q.actorId } : {}), ...(q.action ? { action: { contains: q.action } } : {}), ...(q.targetType ? { targetType: q.targetType } : {}) };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.perPage, take: q.perPage }),
      prisma.auditLog.count({ where }),
    ]);
    return { items, total };
  }

  async dashboard() {
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const [users, newUsers, offers, swapsByStatus, openDisputes, pendingVerifications, openFlags, activeSubs, pendingAds, revenue] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { createdAt: { gte: since30 } } }),
      prisma.swapOffer.count({ where: { status: 'ACTIVE', availableUntil: { gt: new Date() } } }),
      prisma.swap.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.dispute.count({ where: { status: { in: ['OPEN', 'INVESTIGATING'] } } }),
      prisma.verificationCase.count({ where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } }),
      prisma.riskFlag.count({ where: { status: { in: ['OPEN', 'REVIEWING'] } } }),
      prisma.subscription.count({ where: { status: { in: ['ACTIVE', 'TRIALING'] } } }),
      prisma.adCampaign.count({ where: { status: 'PENDING_REVIEW' } }),
      ledgerService.summary(since30, new Date()),
    ]);
    return { users, newUsers30d: newUsers, activeOffers: offers, swapsByStatus: Object.fromEntries(swapsByStatus.map((s) => [s.status, s._count._all])), openDisputes, pendingVerifications, openRiskFlags: openFlags, activeSubscriptions: activeSubs, pendingAdReviews: pendingAds, revenueLast30d: revenue };
  }
}

export const adminService = new AdminService();
