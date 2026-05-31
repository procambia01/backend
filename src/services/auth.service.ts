import prisma from '@/config/database';
import redisClient from '@/config/redis';
import { HelpersUtil } from '@/utils/helpers.util';
import { JwtUtil, JwtPayload } from '@/utils/jwt.util';
import { EmailService } from './email.service';
import { ReferralService } from './referral.service';
import {
  EmailAlreadyExistsError,
  ConflictError,
  InvalidCredentialsError,
  UserNotFoundError,
  InvalidTokenError,
  AccountBannedError,
} from '@/utils/error.util';
import { ActivityType } from '@prisma/client';

export class AuthService {
  private emailService: EmailService;
  private referralService: ReferralService;

  constructor() {
    this.emailService = new EmailService();
    this.referralService = new ReferralService();
  }

  /**
   * Register a new user
   */
  async register(userData: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    referralCode?: string;
  }) {
    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: userData.email },
    });

    if (existingUser) {
      throw new EmailAlreadyExistsError();
    }

    // Hash password
    const passwordHash = await HelpersUtil.hashPassword(userData.password);

    // Normalize phone: treat empty string as null so multiple users without
    // a phone number don't hit the unique constraint on the phone field
    const phone = userData.phone?.trim() || null;

    // Check if phone is already taken (only when provided)
    if (phone) {
      const existingPhone = await prisma.user.findFirst({ where: { phone } });
      if (existingPhone) {
        throw new ConflictError('Phone number is already in use');
      }
    }

    // Create user
    // NOTE: Do NOT pass phone: null — MongoDB's unique index treats null as a
    // concrete value, so two users with no phone both fail the unique constraint.
    // Only include phone in the data object when it actually has a value.
    const createData: any = {
      name: userData.name,
      email: userData.email,
      passwordHash,
    };
    if (phone) {
      createData.phone = phone;
    }

    const user = await prisma.user.create({
      data: createData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    // Handle referral if provided
    if (userData.referralCode) {
      await this.referralService.applyReferralCode(user.id, userData.referralCode);
    }

    // Generate tokens
    const tokens = JwtUtil.generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Send verification email (non-fatal — don't block registration if SMTP is not configured)
    const verificationToken = JwtUtil.generateEmailVerificationToken(user.id, user.email);
    try {
      await this.emailService.sendVerificationEmail(user.email, user.name, verificationToken);
    } catch (emailError) {
      // Log but don't fail registration — user can request resend later
      console.warn(
        '[AuthService] Verification email failed:',
        emailError instanceof Error ? emailError.message : emailError
      );
    }

    // Generate referral code for new user
    await this.referralService.getMyReferralCode(user.id);

    return {
      user,
      tokens,
    };
  }

  /**
   * Login user
   */
  async login(email: string, password: string, rememberMe?: boolean) {
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        role: true,
        isActive: true,
        isBanned: true,
        banReason: true,
        emailVerified: true,
      },
    });

    if (!user) {
      throw new InvalidCredentialsError();
    }

    // Check if account is banned
    if (user.isBanned) {
      throw new AccountBannedError(user.banReason || undefined);
    }

    // Check if account is active
    if (!user.isActive) {
      throw new InvalidCredentialsError();
    }

    // Verify password
    const isPasswordValid = await HelpersUtil.comparePassword(password, user.passwordHash ?? '');
    if (!isPasswordValid) {
      throw new InvalidCredentialsError();
    }

    // Generate tokens
    const tokens = JwtUtil.generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Create session
    await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken: tokens.accessToken,
        expires: new Date(Date.now() + (rememberMe ? 30 : 7) * 24 * 60 * 60 * 1000),
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        description: 'User logged in',
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        emailVerified: user.emailVerified,
      },
      tokens,
    };
  }

  /**
   * Logout user
   */
  async logout(token: string) {
    // Blacklist token
    const decoded = JwtUtil.decode(token);
    if (decoded && decoded.exp) {
      const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
      await redisClient.set(`blacklist:${token}`, 'true', expiresIn);
    }

    // Delete session
    await prisma.session.deleteMany({
      where: { sessionToken: token },
    });
  }

  /**
   * Forgot password
   */
  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      // Don't reveal if user exists
      return;
    }

    // Generate reset token
    const resetToken = JwtUtil.generatePasswordResetToken(user.id, user.email);

    // Send reset email
    await this.emailService.sendPasswordResetEmail(user.email, user.name, resetToken);

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'PASSWORD_RESET_REQUESTED' as ActivityType,
        description: 'Password reset requested',
      },
    });
  }

  /**
   * Reset password
   */
  async resetPassword(token: string, newPassword: string) {
    // Verify token
    const { userId } = JwtUtil.verifyPasswordResetToken(token);

    // Hash new password
    const passwordHash = await HelpersUtil.hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Revoke all sessions
    await prisma.session.deleteMany({
      where: { userId },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'PASSWORD_RESET_COMPLETED' as ActivityType,
        description: 'Password reset completed',
      },
    });
  }

  /**
   * Verify email
   */
  async verifyEmail(token: string) {
    // Verify token
    const { userId } = JwtUtil.verifyEmailVerificationToken(token);

    // Update user
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'EMAIL_VERIFIED' as ActivityType,
        description: 'Email verified',
      },
    });
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(email: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, emailVerified: true },
    });

    if (!user) {
      throw new UserNotFoundError();
    }

    if (user.emailVerified) {
      return; // Already verified
    }

    // Generate new token
    const verificationToken = JwtUtil.generateEmailVerificationToken(user.id, user.email);

    // Send email
    await this.emailService.sendVerificationEmail(user.email, user.name, verificationToken);
  }

  /**
   * Get current user
   */
  async getCurrentUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        phone: true,
        emailVerified: true,
        phoneVerified: true,
        idVerified: true,
        rating: true,
        totalSwaps: true,
        isPremium: true,
        premiumTier: true,
        premiumExpiry: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UserNotFoundError();
    }

    return user;
  }

  /**
   * Change password
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });

    if (!user) {
      throw new UserNotFoundError();
    }

    // Verify current password
    const isPasswordValid = await HelpersUtil.comparePassword(
      currentPassword,
      user.passwordHash ?? ''
    );
    if (!isPasswordValid) {
      throw new InvalidCredentialsError();
    }

    // Hash new password
    const passwordHash = await HelpersUtil.hashPassword(newPassword);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Revoke all sessions except current
    await prisma.session.deleteMany({
      where: { userId },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'PASSWORD_CHANGED',
        description: 'Password changed',
      },
    });
  }

  /**
   * Enable two-factor authentication
   */
  async enableTwoFactor(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'TWO_FACTOR_ENABLED' as ActivityType,
        description: 'Two-factor authentication enabled',
      },
    });

    return { enabled: true };
  }

  /**
   * Disable two-factor authentication
   */
  async disableTwoFactor(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'TWO_FACTOR_DISABLED' as ActivityType,
        description: 'Two-factor authentication disabled',
      },
    });
  }

  /**
   * Verify two-factor code
   */
  async verifyTwoFactor(userId: string, code: string) {
    // In production, verify against actual TOTP/SMS code
    // For now, just validate format
    if (code.length !== 6) {
      throw new InvalidTokenError();
    }

    return { verified: true };
  }

  /**
   * Get all sessions
   */
  async getSessions(userId: string) {
    const sessions = await prisma.session.findMany({
      where: { userId },
      select: {
        id: true,
        sessionToken: true,
        expires: true,
        createdAt: true,
        ipAddress: true,
        userAgent: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions;
  }

  /**
   * Revoke a session
   */
  async revokeSession(userId: string, sessionId: string) {
    await prisma.session.delete({
      where: {
        id: sessionId,
        userId,
      },
    });
  }

  /**
   * Revoke all sessions except current
   */
  async revokeAllSessions(userId: string, currentToken?: string) {
    await prisma.session.deleteMany({
      where: {
        userId,
        NOT: currentToken ? { sessionToken: currentToken } : undefined,
      },
    });
  }
}
