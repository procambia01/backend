import type { User } from '@prisma/client';
import { prisma } from '@/config/database';
import { config } from '@/config/env';
import type { AuthResult, LoginRequest, RegisterRequest } from '@/contracts';
import { decryptSecret, encryptSecret, randomToken, sha256Hex, timingSafeEqualHex } from '@/lib/crypto';
import { generateBase32Secret, otpauthUrl, verifyTotp } from '@/lib/totp';
import { effectivePlan } from '@/lib/entitlements';
import { toMe } from '@/presenters/user.presenter';
import { HelpersUtil } from '@/utils/helpers.util';
import {
  AppError,
  BadRequestError,
  EmailAlreadyExistsError,
  InvalidCredentialsError,
  InvalidTokenError,
  AccountBannedError,
  AccountSuspendedError,
  UnauthorizedError,
  UserNotFoundError,
} from '@/utils/error.util';
import { emailService } from './email.service';
import { sessionService, SessionMeta, hashDevice, hashIp } from './session.service';
import { logActivity } from './activity.service';
import { auditService } from './audit.service';
import { referralService } from './referral.service';
import { riskService } from './risk.service';
import { resolveLocale } from '@/i18n';

const EMAIL_VERIFY_TTL_MS = 24 * 3600_000;
const PASSWORD_RESET_TTL_MS = 3600_000;
const BACKUP_CODE_COUNT = 10;

export class AuthService {
  // ───────────── registration / login ─────────────

  async register(input: RegisterRequest, meta: SessionMeta): Promise<AuthResult> {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new EmailAlreadyExistsError();

    const user = await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await HelpersUtil.hashPassword(input.password),
        // The phone is only a claim until the OTP flow proves it.
        phone: input.phone ?? null,
        languagePreference: resolveLocale(input.language),
        timezone: input.timezone ?? 'UTC',
      },
    });

    await referralService.ensureCode(user.id);
    if (input.referralCode) {
      await referralService
        .attachOnSignup({
          referredId: user.id,
          code: input.referralCode,
          deviceHash: meta.deviceId ? hashDevice(meta.deviceId) : null,
          ipHash: meta.ip ? hashIp(meta.ip) : null,
        })
        .catch(() => undefined); // a bad referral code never blocks registration
    }
    await this.registerDevice(user, meta, false);
    await this.sendVerificationEmail(user);

    const tokens = await sessionService.create(user, meta);
    await logActivity(user.id, 'LOGIN', 'Registered and signed in');
    return { user: toMe(user), tokens };
  }

  async login(input: LoginRequest, meta: SessionMeta): Promise<AuthResult> {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    // Compare even for unknown accounts so timing does not reveal which emails exist.
    const ok = await HelpersUtil.comparePassword(input.password, user?.passwordHash ?? '');
    if (!user || !user.passwordHash || !ok || user.deletedAt) throw new InvalidCredentialsError();
    this.assertCanAuthenticate(user);

    if (user.twoFactorEnabled) {
      if (!input.twoFactorCode) throw new AppError('Two-factor code required', 401, 'TWO_FACTOR_REQUIRED', { twoFactorRequired: true });
      const valid = await this.checkSecondFactor(user.id, input.twoFactorCode);
      if (!valid) throw new InvalidCredentialsError('Invalid two-factor code');
    }

    const isNewDevice = await this.registerDevice(user, meta, true);
    const tokens = await sessionService.create(user, meta);
    await logActivity(user.id, 'LOGIN', 'Signed in');
    if (isNewDevice) {
      void emailService.sendLoginAlert(
        user.email,
        user.name,
        meta.deviceName || meta.userAgent?.slice(0, 80) || 'Unknown device',
        meta.ip ?? 'unknown',
        new Date().toUTCString(),
        user.languagePreference
      );
    }
    return { user: toMe(user), tokens };
  }

  private assertCanAuthenticate(user: User): void {
    if (!user.isActive) throw new UnauthorizedError('Account is disabled');
    if (user.isBanned && (!user.banExpiry || user.banExpiry.getTime() > Date.now())) throw new AccountBannedError(user.banReason ?? undefined);
    if (user.isSuspended && (!user.suspensionExpiry || user.suspensionExpiry.getTime() > Date.now())) {
      throw new AccountSuspendedError(user.suspensionReason ?? undefined);
    }
  }

  /** Returns true when the device had not been seen before for an account that already had devices. */
  private async registerDevice(user: User, meta: SessionMeta, alertable: boolean): Promise<boolean> {
    const basis = meta.deviceId || meta.userAgent;
    if (!basis) return false;
    const deviceHash = hashDevice(basis);
    const known = await prisma.loginDevice.findUnique({ where: { userId_deviceHash: { userId: user.id, deviceHash } } });
    if (known) {
      await prisma.loginDevice.update({ where: { id: known.id }, data: { lastSeen: new Date() } });
      return false;
    }
    const hadAny = (await prisma.loginDevice.count({ where: { userId: user.id } })) > 0;
    await prisma.loginDevice.create({ data: { userId: user.id, deviceHash, label: meta.deviceName?.slice(0, 128) } });
    void riskService.onDeviceSeen(user.id, deviceHash).catch(() => undefined);
    return alertable && hadAny;
  }

  async refresh(refreshToken: string, meta: SessionMeta): Promise<AuthResult> {
    const { user, tokens } = await sessionService.refresh(refreshToken, meta);
    return { user: toMe(user), tokens };
  }

  async logout(sessionId: string, userId: string): Promise<void> {
    await sessionService.revokeBySessionId(sessionId, userId);
    await logActivity(userId, 'LOGOUT', 'Signed out');
  }

  async logoutAll(userId: string): Promise<void> {
    await sessionService.revokeAll(userId);
    await logActivity(userId, 'SESSIONS_REVOKED', 'Signed out of all devices');
  }

  // ───────────── re-authentication ─────────────

  async reauthenticate(userId: string, sessionId: string, password: string, twoFactorCode?: string): Promise<{ reauthUntil: string }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError();
    const ok = await HelpersUtil.comparePassword(password, user.passwordHash ?? '');
    if (!ok || !user.passwordHash) throw new InvalidCredentialsError();
    if (user.twoFactorEnabled) {
      if (!twoFactorCode) throw new AppError('Two-factor code required', 401, 'TWO_FACTOR_REQUIRED', { twoFactorRequired: true });
      if (!(await this.checkSecondFactor(userId, twoFactorCode))) throw new InvalidCredentialsError('Invalid two-factor code');
    }
    const until = await sessionService.markReauthenticated(sessionId);
    return { reauthUntil: until.toISOString() };
  }

  // ───────────── email verification & password reset ─────────────

  private async createEmailToken(userId: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET', ttlMs: number): Promise<string> {
    const token = randomToken(32);
    // Only the newest token per purpose is valid.
    await prisma.emailToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    await prisma.emailToken.create({ data: { userId, purpose, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + ttlMs) } });
    return token;
  }

  private async consumeEmailToken(token: string, purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET'): Promise<string> {
    const hash = sha256Hex(token);
    const row = await prisma.emailToken.findUnique({ where: { tokenHash: hash } });
    if (!row || row.purpose !== purpose) throw new InvalidTokenError();
    const claimed = await prisma.emailToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new InvalidTokenError();
    return row.userId;
  }

  async sendVerificationEmail(user: User): Promise<void> {
    if (user.emailVerified) return;
    const token = await this.createEmailToken(user.id, 'EMAIL_VERIFY', EMAIL_VERIFY_TTL_MS);
    await emailService.sendVerificationEmail(user.email, user.name, token, user.languagePreference);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError();
    await this.sendVerificationEmail(user);
  }

  async verifyEmail(token: string): Promise<void> {
    const userId = await this.consumeEmailToken(token, 'EMAIL_VERIFY');
    await prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
    await logActivity(userId, 'EMAIL_VERIFIED', 'Email verified');
  }

  /** Always resolves the same way so account existence is not revealed. */
  async forgotPassword(email: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt || !user.isActive) return;
    const token = await this.createEmailToken(user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_MS);
    await emailService.sendPasswordResetEmail(user.email, user.name, token, user.languagePreference);
    await logActivity(user.id, 'PASSWORD_RESET_REQUESTED', 'Password reset requested');
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.consumeEmailToken(token, 'PASSWORD_RESET');
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await HelpersUtil.hashPassword(password), passwordChangedAt: new Date(), tokenVersion: { increment: 1 } },
    });
    await sessionService.revokeAll(userId, 'PASSWORD_RESET');
    await logActivity(userId, 'PASSWORD_RESET_COMPLETED', 'Password reset completed');
  }

  /** Requires a recent re-authentication (enforced by the route). Invalidates every other session. */
  async changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string): Promise<AuthResult['tokens']> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new UserNotFoundError();
    if (!(await HelpersUtil.comparePassword(currentPassword, user.passwordHash))) throw new InvalidCredentialsError('Current password is incorrect');
    if (currentPassword === newPassword) throw new BadRequestError('New password must be different');

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await HelpersUtil.hashPassword(newPassword), passwordChangedAt: new Date(), tokenVersion: { increment: 1 } },
    });
    await sessionService.revokeAll(userId, 'PASSWORD_CHANGED');
    await auditService.record({ actorId: userId, action: 'auth.password_changed', targetType: 'User', targetId: userId });
    await logActivity(userId, 'PASSWORD_CHANGED', 'Password changed');
    void sessionId;
    // Issue a fresh session for the device that made the change.
    return sessionService.create(updated, {}, { reauth: true });
  }

  // ───────────── two-factor authentication ─────────────

  async beginTwoFactorSetup(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundError();
    if (user.twoFactorEnabled) throw new BadRequestError('Two-factor authentication is already enabled');
    const secret = generateBase32Secret();
    const secretEnc = encryptSecret(secret, config.security.dataEncryptionKey);
    await prisma.twoFactorSecret.upsert({
      where: { userId },
      create: { userId, secretEnc },
      update: { secretEnc, confirmedAt: null, backupCodeHashes: [] },
    });
    return { secret, otpauthUrl: otpauthUrl(user.email, secret, config.appName) };
  }

  async enableTwoFactor(userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const row = await prisma.twoFactorSecret.findUnique({ where: { userId } });
    if (!row || row.confirmedAt) throw new BadRequestError('Start two-factor setup first');
    const secret = decryptSecret(row.secretEnc, config.security.dataEncryptionKey);
    if (!verifyTotp(secret, code)) throw new InvalidCredentialsError('Invalid two-factor code');

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => randomToken(8).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase().padEnd(10, 'X'));
    await prisma.$transaction([
      prisma.twoFactorSecret.update({
        where: { userId },
        data: { confirmedAt: new Date(), backupCodeHashes: backupCodes.map((c) => sha256Hex(c)) },
      }),
      prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } }),
    ]);
    await logActivity(userId, 'TWO_FACTOR_ENABLED', 'Two-factor authentication enabled');
    await auditService.record({ actorId: userId, action: 'auth.2fa_enabled', targetType: 'User', targetId: userId });
    return { backupCodes };
  }

  async disableTwoFactor(userId: string, password: string, code: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new UserNotFoundError();
    if (!(await HelpersUtil.comparePassword(password, user.passwordHash))) throw new InvalidCredentialsError();
    if (!(await this.checkSecondFactor(userId, code))) throw new InvalidCredentialsError('Invalid two-factor code');
    await prisma.$transaction([
      prisma.twoFactorSecret.deleteMany({ where: { userId } }),
      prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } }),
    ]);
    await logActivity(userId, 'TWO_FACTOR_DISABLED', 'Two-factor authentication disabled');
    await auditService.record({ actorId: userId, action: 'auth.2fa_disabled', targetType: 'User', targetId: userId });
  }

  /** TOTP or single-use backup code. */
  private async checkSecondFactor(userId: string, code: string): Promise<boolean> {
    const row = await prisma.twoFactorSecret.findUnique({ where: { userId } });
    if (!row?.confirmedAt) return false;
    if (/^\d{6}$/.test(code)) {
      return verifyTotp(decryptSecret(row.secretEnc, config.security.dataEncryptionKey), code);
    }
    const hash = sha256Hex(code.toUpperCase());
    const match = row.backupCodeHashes.find((h) => timingSafeEqualHex(h, hash));
    if (!match) return false;
    // Single use: remove atomically-ish (only succeeds if still present).
    const res = await prisma.twoFactorSecret.updateMany({
      where: { userId, backupCodeHashes: { has: match } },
      data: { backupCodeHashes: row.backupCodeHashes.filter((h) => h !== match) },
    });
    return res.count === 1;
  }

  async me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new UserNotFoundError();
    return toMe(user);
  }

  /** Used by the auth middleware to expose the effective plan on req.user. */
  static effectivePlanOf(user: User) {
    return effectivePlan(user);
  }
}

export const authService = new AuthService();
