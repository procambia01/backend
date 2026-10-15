import { prisma } from '@/config/database';
import { config } from '@/config/env';
import { keyedHash, randomNumericCode, timingSafeEqualHex } from '@/lib/crypto';
import { tr } from '@/i18n';
import { ConflictError, NotFoundError, TooManyRequestsError, BadRequestError } from '@/utils/error.util';
import { logActivity } from './activity.service';
import { smsService } from './sms.service';

const OTP_TTL_MS = 10 * 60_000;
const RESEND_COOLDOWN_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_PER_DAY = 10;

const hashCode = (userId: string, phone: string, code: string) => keyedHash(config.security.hashPepper, `otp:${userId}:${phone}:${code}`);

export class PhoneService {
  async requestOtp(userId: string, phone: string): Promise<{ resendAvailableAt: string; expiresAt: string }> {
    const taken = await prisma.verifiedPhone.findUnique({ where: { phone } });
    if (taken && taken.userId !== userId) throw new ConflictError('This phone number is already verified on another account');

    const now = new Date();
    const latest = await prisma.otpChallenge.findFirst({ where: { userId, purpose: 'PHONE_VERIFY' }, orderBy: { createdAt: 'desc' } });
    if (latest && latest.resendAvailableAt > now) {
      throw new TooManyRequestsError(`Please wait before requesting another code`, { retryAfterSeconds: Math.ceil((latest.resendAvailableAt.getTime() - now.getTime()) / 1000) });
    }
    const today = await prisma.otpChallenge.count({ where: { userId, purpose: 'PHONE_VERIFY', createdAt: { gte: new Date(now.getTime() - 86_400_000) } } });
    if (today >= MAX_PER_DAY) throw new TooManyRequestsError('Daily verification code limit reached');

    // A new challenge supersedes older ones.
    await prisma.otpChallenge.updateMany({ where: { userId, purpose: 'PHONE_VERIFY', consumedAt: null }, data: { consumedAt: now } });

    const code = randomNumericCode(6);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { languagePreference: true } });
    const challenge = await prisma.otpChallenge.create({
      data: { userId, purpose: 'PHONE_VERIFY', phone, codeHash: hashCode(userId, phone, code), maxAttempts: MAX_ATTEMPTS, resendAvailableAt: new Date(now.getTime() + RESEND_COOLDOWN_MS), expiresAt: new Date(now.getTime() + OTP_TTL_MS) },
    });
    await smsService.send(phone, tr(user.languagePreference, 'sms.otp', { code }));
    return { resendAvailableAt: challenge.resendAvailableAt.toISOString(), expiresAt: challenge.expiresAt.toISOString() };
  }

  async verifyOtp(userId: string, code: string): Promise<void> {
    const now = new Date();
    const ch = await prisma.otpChallenge.findFirst({ where: { userId, purpose: 'PHONE_VERIFY', consumedAt: null }, orderBy: { createdAt: 'desc' } });
    if (!ch) throw new NotFoundError('No pending verification code');
    if (ch.expiresAt <= now) throw new BadRequestError('The code has expired. Request a new one.');
    if (ch.attempts >= ch.maxAttempts) throw new TooManyRequestsError('Too many incorrect attempts. Request a new code.');

    // Count the attempt first (atomic) so parallel guesses cannot exceed the limit.
    const counted = await prisma.otpChallenge.updateMany({ where: { id: ch.id, attempts: { lt: ch.maxAttempts }, consumedAt: null }, data: { attempts: { increment: 1 } } });
    if (counted.count !== 1) throw new TooManyRequestsError('Too many incorrect attempts. Request a new code.');

    if (!timingSafeEqualHex(ch.codeHash, hashCode(userId, ch.phone, code))) throw new BadRequestError('Incorrect code');

    const claimed = await prisma.otpChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: now } });
    if (claimed.count !== 1) throw new ConflictError('Code already used');

    const holder = await prisma.verifiedPhone.findUnique({ where: { phone: ch.phone } });
    if (holder && holder.userId !== userId) throw new ConflictError('This phone number is already verified on another account');
    try {
      await prisma.verifiedPhone.upsert({ where: { userId }, create: { userId, phone: ch.phone }, update: { phone: ch.phone, verifiedAt: now } });
    } catch {
      throw new ConflictError('This phone number is already verified on another account');
    }
    await prisma.user.update({ where: { id: userId }, data: { phone: ch.phone, phoneVerified: true, phoneVerifiedAt: now } });
    await logActivity(userId, 'PHONE_VERIFIED', 'Phone number verified');
  }

  async purgeExpired(): Promise<number> {
    const r = await prisma.otpChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
    return r.count;
  }
}

export const phoneService = new PhoneService();
