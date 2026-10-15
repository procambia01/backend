import type { AuthSession, User } from '@prisma/client';
import { prisma } from '@/config/database';
import { config } from '@/config/env';
import type { AuthTokens } from '@/contracts';
import { keyedHash, randomToken, sha256Hex } from '@/lib/crypto';
import { JwtUtil, durationToMs } from '@/utils/jwt.util';
import { InvalidTokenError, UnauthorizedError } from '@/utils/error.util';
import logger from '@/utils/logger.util';

export interface SessionMeta {
  deviceId?: string | null;
  deviceName?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Re-authentication window for sensitive actions (password change, 2FA changes, API keys, payouts…). */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;
/** A just-rotated token presented again within this window is treated as a client retry, not theft. */
const ROTATION_GRACE_MS = 10 * 1000;

export const hashDevice = (v: string) => keyedHash(config.security.hashPepper, `device:${v}`);
export const hashIp = (v: string) => keyedHash(config.security.hashPepper, `ip:${v}`);
export const hashRefresh = (token: string) => sha256Hex(token);

export class SessionService {
  private refreshTtlMs() {
    return durationToMs(config.jwt.refreshExpiresIn);
  }

  private issue(user: Pick<User, 'id' | 'role' | 'email' | 'tokenVersion'>, session: AuthSession, refreshToken: string): AuthTokens {
    const { token, expiresAt } = JwtUtil.signAccessToken({
      sub: user.id,
      sid: session.id,
      tv: user.tokenVersion,
      role: user.role,
      email: user.email,
    });
    return { accessToken: token, refreshToken, accessTokenExpiresAt: expiresAt.toISOString(), sessionId: session.id };
  }

  /** Create a brand-new login session (new token family). */
  async create(user: User, meta: SessionMeta, opts: { reauth?: boolean } = {}): Promise<AuthTokens> {
    const refreshToken = randomToken(48);
    const now = Date.now();
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        familyId: randomToken(16),
        refreshTokenHash: hashRefresh(refreshToken),
        deviceId: meta.deviceId ? hashDevice(meta.deviceId) : null,
        deviceName: meta.deviceName?.slice(0, 128) ?? null,
        ipAddress: meta.ip ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        expiresAt: new Date(now + this.refreshTtlMs()),
        reauthUntil: opts.reauth === false ? null : new Date(now + REAUTH_WINDOW_MS),
      },
    });
    return this.issue(user, session, refreshToken);
  }

  /**
   * Rotate a refresh token. The presented token becomes unusable; presenting an
   * already-rotated token again (beyond the retry grace) revokes the whole family.
   */
  async refresh(presented: string, meta: SessionMeta): Promise<{ user: User; tokens: AuthTokens }> {
    const hash = hashRefresh(presented);
    const current = await prisma.authSession.findUnique({ where: { refreshTokenHash: hash } });
    if (!current) throw new InvalidTokenError();

    if (current.revokedAt) throw new InvalidTokenError();

    if (current.rotatedAt) {
      if (Date.now() - current.rotatedAt.getTime() > ROTATION_GRACE_MS) {
        await this.revokeFamily(current.familyId, 'REFRESH_TOKEN_REUSE');
        logger.warn('refresh token reuse detected; family revoked', { userId: current.userId, familyId: current.familyId });
      }
      throw new InvalidTokenError();
    }
    if (current.expiresAt.getTime() <= Date.now()) throw new InvalidTokenError();

    const user = await prisma.user.findUnique({ where: { id: current.userId } });
    if (!user || user.deletedAt || !user.isActive || user.isBanned) {
      await this.revokeFamily(current.familyId, 'ACCOUNT_INACTIVE');
      throw new UnauthorizedError('Account is not active');
    }

    // Atomic claim: exactly one concurrent request wins the rotation.
    const claimed = await prisma.authSession.updateMany({
      where: { id: current.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date(), lastUsedAt: new Date() },
    });
    if (claimed.count !== 1) throw new InvalidTokenError();

    const refreshToken = randomToken(48);
    const next = await prisma.authSession.create({
      data: {
        userId: user.id,
        familyId: current.familyId,
        refreshTokenHash: hashRefresh(refreshToken),
        deviceId: current.deviceId,
        deviceName: current.deviceName,
        ipAddress: meta.ip ?? current.ipAddress,
        userAgent: meta.userAgent?.slice(0, 300) ?? current.userAgent,
        // The absolute lifetime of a login does not extend on rotation.
        expiresAt: current.expiresAt,
        reauthUntil: current.reauthUntil,
      },
    });
    return { user, tokens: this.issue(user, next, refreshToken) };
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await prisma.authSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Logout of the login that owns this session row. */
  async revokeBySessionId(sessionId: string, userId: string, reason = 'LOGOUT'): Promise<void> {
    const s = await prisma.authSession.findFirst({ where: { id: sessionId, userId } });
    if (s) await this.revokeFamily(s.familyId, reason);
  }

  /** "Log out everywhere": revoke every session and invalidate all outstanding access tokens. */
  async revokeAll(userId: string, reason = 'LOGOUT_ALL', exceptFamilyId?: string): Promise<void> {
    await prisma.authSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (!exceptFamilyId) await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  }

  /** One row per login (family), most recent rotation. */
  async list(userId: string, currentSessionId?: string) {
    const rows = await prisma.authSession.findMany({
      where: { userId, revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      take: 50,
    });
    return rows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      ipAddress: s.ipAddress ? s.ipAddress.replace(/(\d+\.\d+)\.\d+\.\d+/, '$1.x.x') : null,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async revokeOne(userId: string, sessionId: string): Promise<void> {
    await this.revokeBySessionId(sessionId, userId, 'REVOKED_BY_USER');
  }

  async markReauthenticated(sessionId: string): Promise<Date> {
    const until = new Date(Date.now() + REAUTH_WINDOW_MS);
    await prisma.authSession.update({ where: { id: sessionId }, data: { reauthUntil: until } });
    return until;
  }

  async purgeExpired(): Promise<number> {
    const r = await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
    return r.count;
  }
}

export const sessionService = new SessionService();
