import crypto from 'crypto';
import { prisma } from '@/config/database';
import { sha256Hex } from '@/lib/crypto';
import { BadRequestError, ForbiddenError, LimitExceededError, NotFoundError, PlanRequiredError, TooManyRequestsError, UnauthorizedError } from '@/utils/error.util';
import { toApiKeyDto } from '@/presenters/billing.presenter';
import { auditService } from './audit.service';
import { limitService } from './limit.service';

import { API_SCOPES, type ApiKeyCreatedDto, type ApiKeyUsageDto } from '@/contracts';
const KEY_PREFIX = 'cmk_live_';
const MAX_KEYS_PER_USER = 10;

const hashKey = (raw: string) => sha256Hex(raw);
const today = () => new Date().toISOString().slice(0, 10);

function generate() {
  const id = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(24).toString('base64url');
  const raw = `${KEY_PREFIX}${id}_${secret}`;
  return { raw, prefix: `${KEY_PREFIX}${id}`, hash: hashKey(raw) };
}

export class ApiKeyService {
  private async planDefaults(userId: string) {
    const sub = await prisma.subscription.findFirst({ where: { userId, kind: 'API_PLAN', status: { in: ['ACTIVE', 'TRIALING'] } }, orderBy: { createdAt: 'desc' } });
    const product = sub ? await prisma.serviceProduct.findUnique({ where: { code: sub.productCode } }) : null;
    const cfg = (product?.config ?? {}) as { rateLimitPerMinute?: number; monthlyQuota?: number };
    const limits = await limitService.forUser(userId);
    return {
      rateLimitPerMinute: cfg.rateLimitPerMinute ?? 60,
      monthlyQuota: cfg.monthlyQuota ?? limits.apiCallsPerMonth,
      allowed: limits.apiAccess || !!sub,
    };
  }

  async create(userId: string, input: { name: string; scopes: string[]; expiresInDays?: number }) {
    const defaults = await this.planDefaults(userId);
    if (!defaults.allowed) throw new PlanRequiredError('API access requires a Business or API plan');
    if ((await prisma.apiKey.count({ where: { userId, isActive: true } })) >= MAX_KEYS_PER_USER) throw new LimitExceededError('Too many active API keys');
    const scopes = [...new Set(input.scopes)].filter((s): s is (typeof API_SCOPES)[number] => (API_SCOPES as readonly string[]).includes(s));
    if (!scopes.length) throw new BadRequestError('At least one valid scope is required');
    const g = generate();
    const row = await prisma.apiKey.create({
      data: {
        userId, name: input.name, keyPrefix: g.prefix, keyHash: g.hash, scopes,
        rateLimitPerMinute: defaults.rateLimitPerMinute, monthlyQuota: defaults.monthlyQuota,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
      },
    });
    await auditService.record({ actorId: userId, action: 'apikey.create', targetType: 'ApiKey', targetId: row.id, after: { name: row.name, scopes, prefix: row.keyPrefix } });
    // The only time the raw key is ever visible.
    return { ...this.toDto(row), key: g.raw } satisfies ApiKeyCreatedDto;
  }

  async rotate(userId: string, id: string) {
    const old = await prisma.apiKey.findFirst({ where: { id, userId, isActive: true } });
    if (!old) throw new NotFoundError('API key not found');
    const g = generate();
    const [, created] = await prisma.$transaction([
      prisma.apiKey.update({ where: { id }, data: { isActive: false, revokedAt: new Date(), revokedBy: userId } }),
      prisma.apiKey.create({
        data: { userId, name: old.name, keyPrefix: g.prefix, keyHash: g.hash, scopes: old.scopes, rateLimitPerMinute: old.rateLimitPerMinute, monthlyQuota: old.monthlyQuota, expiresAt: old.expiresAt, rotatedFromId: old.id },
      }),
    ]);
    await auditService.record({ actorId: userId, action: 'apikey.rotate', targetType: 'ApiKey', targetId: id, after: { newKeyId: created.id } });
    return { ...this.toDto(created), key: g.raw } satisfies ApiKeyCreatedDto;
  }

  async revoke(actorId: string, id: string, opts: { admin?: boolean; reason?: string } = {}) {
    const where = opts.admin ? { id } : { id, userId: actorId };
    const key = await prisma.apiKey.findFirst({ where });
    if (!key) throw new NotFoundError('API key not found');
    await prisma.apiKey.update({ where: { id }, data: { isActive: false, revokedAt: new Date(), revokedBy: actorId } });
    await auditService.record({ actorId, action: opts.admin ? 'apikey.admin_revoke' : 'apikey.revoke', targetType: 'ApiKey', targetId: id, reason: opts.reason });
  }

  async list(userId: string) {
    const rows = await prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toDto(r));
  }

  async usage(userId: string, id: string, days = 30) {
    const key = await prisma.apiKey.findFirst({ where: { id, userId } });
    if (!key) throw new NotFoundError('API key not found');
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const rows = await prisma.apiUsageDaily.findMany({ where: { apiKeyId: id, day: { gte: since } }, orderBy: { day: 'asc' } });
    const out: ApiKeyUsageDto = { monthlyQuota: key.monthlyQuota, usedThisMonth: key.requestCount, days: rows.map((r) => ({ day: r.day, count: r.count, errors: r.errors })) };
    return out;
  }

  private toDto = toApiKeyDto;

  /** Verifies a presented key and counts the call against the monthly quota (atomic). */
  async authenticate(rawKey: string | undefined, requiredScope: string) {
    if (!rawKey || !rawKey.startsWith(KEY_PREFIX) || rawKey.length > 120) throw new UnauthorizedError('Missing or invalid API key');
    const key = await prisma.apiKey.findUnique({ where: { keyHash: hashKey(rawKey) } });
    if (!key || !key.isActive || key.revokedAt) throw new UnauthorizedError('Invalid or revoked API key');
    if (key.expiresAt && key.expiresAt <= new Date()) throw new UnauthorizedError('API key has expired');
    if (!key.scopes.includes(requiredScope)) throw new ForbiddenError('API key lacks the required scope');

    const owner = await prisma.user.findUnique({ where: { id: key.userId }, select: { isActive: true, isBanned: true, deletedAt: true } });
    if (!owner || !owner.isActive || owner.isBanned || owner.deletedAt) throw new UnauthorizedError('Invalid or revoked API key');

    const counted = await prisma.apiKey.updateMany({ where: { id: key.id, requestCount: { lt: key.monthlyQuota } }, data: { requestCount: { increment: 1 }, lastUsedAt: new Date() } });
    if (counted.count !== 1) throw new TooManyRequestsError('Monthly API quota exhausted', { limit: 'monthlyQuota' });
    await prisma.apiUsageDaily
      .upsert({ where: { apiKeyId_day: { apiKeyId: key.id, day: today() } }, create: { apiKeyId: key.id, day: today(), count: 1 }, update: { count: { increment: 1 } } })
      .catch(() => undefined);
    return { id: key.id, ownerId: key.userId, scopes: key.scopes, rateLimitPerMinute: key.rateLimitPerMinute };
  }

  /** Called after API plan changes: refresh limits on the owner's active keys. */
  async syncPlanLimits(userId: string): Promise<void> {
    const d = await this.planDefaults(userId);
    if (!d.allowed) {
      await prisma.apiKey.updateMany({ where: { userId, isActive: true }, data: { isActive: false, revokedAt: new Date() } });
      return;
    }
    await prisma.apiKey.updateMany({ where: { userId, isActive: true }, data: { rateLimitPerMinute: d.rateLimitPerMinute, monthlyQuota: d.monthlyQuota } });
  }

  async resetMonthlyCounters(): Promise<number> {
    const r = await prisma.apiKey.updateMany({ where: { requestCount: { gt: 0 } }, data: { requestCount: 0 } });
    return r.count;
  }

  async adminList(page: number, perPage: number) {
    const [items, total] = await Promise.all([
      prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      prisma.apiKey.count(),
    ]);
    return { items: items.map((k) => ({ ...this.toDto(k), userId: k.userId })), total };
  }
}

export const apiKeyService = new ApiKeyService();
