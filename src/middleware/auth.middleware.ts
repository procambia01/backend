import { NextFunction, Request, Response } from 'express';
import type { PlanTier } from '@prisma/client';
import { prisma } from '@/config/database';
import { effectivePlan } from '@/lib/entitlements';
import { JwtUtil } from '@/utils/jwt.util';
import {
  AccountBannedError,
  AccountSuspendedError,
  ForbiddenError,
  InvalidTokenError,
  PlanRequiredError,
  ReauthRequiredError,
  UnauthorizedError,
  VerificationRequiredError,
} from '@/utils/error.util';
import { bindUserToContext } from './logger.middleware';

async function resolve(req: Request): Promise<void> {
  const token = JwtUtil.extractTokenFromHeader(req.headers.authorization);
  if (!token) throw new UnauthorizedError('Authentication required');
  const claims = JwtUtil.verifyAccessToken(token);

  const [session, user] = await Promise.all([
    prisma.authSession.findUnique({ where: { id: claims.sid } }),
    prisma.user.findUnique({ where: { id: claims.sub } }),
  ]);

  // Server-side revocation: logout, password change and "log out everywhere" take effect immediately.
  if (!session || session.userId !== claims.sub || session.revokedAt) throw new InvalidTokenError();
  if (!user || user.deletedAt || !user.isActive) throw new UnauthorizedError('Account is not active');
  if (user.tokenVersion !== claims.tv) throw new InvalidTokenError();
  if (user.isBanned && (!user.banExpiry || user.banExpiry.getTime() > Date.now())) throw new AccountBannedError(user.banReason ?? undefined);
  if (user.isSuspended && (!user.suspensionExpiry || user.suspensionExpiry.getTime() > Date.now())) {
    throw new AccountSuspendedError(user.suspensionReason ?? undefined);
  }

  req.user = {
    userId: user.id,
    email: user.email,
    // Role comes from the database, never from the token, so demotions apply at once.
    role: user.role,
    sessionId: session.id,
    familyId: session.familyId,
    planTier: effectivePlan(user),
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    idVerified: user.idVerified && user.verificationStatus === 'VERIFIED',
    reauthUntil: session.reauthUntil,
    language: user.languagePreference,
  };
  bindUserToContext(user.id);
}

export class AuthMiddleware {
  static authenticate = (req: Request, _res: Response, next: NextFunction): void => {
    resolve(req).then(() => next(), next);
  };

  /** Attaches req.user when a valid token is present; otherwise continues anonymously. */
  static optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.headers.authorization) return next();
    resolve(req).then(() => next(), () => next());
  };

  /** Sensitive actions need a password confirmation within the last 10 minutes. */
  static requireRecentAuth = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (!req.user.reauthUntil || req.user.reauthUntil.getTime() <= Date.now()) return next(new ReauthRequiredError());
    next();
  };

  static requireEmailVerified = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (!req.user.emailVerified) return next(new VerificationRequiredError('Please verify your email address first'));
    next();
  };

  static requirePhoneVerified = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (!req.user.phoneVerified) return next(new VerificationRequiredError('Please verify your phone number first'));
    next();
  };

  static requireIdVerified = (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (!req.user.idVerified) return next(new VerificationRequiredError('Identity verification is required'));
    next();
  };

  static requirePlan = (...tiers: PlanTier[]) => (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new UnauthorizedError());
    if (!tiers.includes(req.user.planTier)) return next(new PlanRequiredError(`This feature requires: ${tiers.join(' or ')}`));
    next();
  };

  static forbidApiKeyAuth = (req: Request, _res: Response, next: NextFunction): void => {
    if (req.apiKey) return next(new ForbiddenError('Not available to API keys'));
    next();
  };
}

export const authenticate = AuthMiddleware.authenticate;
export default AuthMiddleware;
