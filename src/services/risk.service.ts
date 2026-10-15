import type { Prisma, RiskAction, RiskFlagType, RiskSeverity, User } from '@prisma/client';
import { prisma } from '@/config/database';
import { convertMinor } from '@/lib/money';
import { BadRequestError, NotFoundError, RiskBlockedError, VerificationRequiredError } from '@/utils/error.util';
import logger from '@/utils/logger.util';
import { auditService } from './audit.service';
import { currencyService } from './currency.service';
import { exchangeRateService } from './exchangeRate.service';
import { systemConfig } from './system-config.service';

interface FlagInput {
  userId?: string;
  swapId?: string;
  offerId?: string;
  referralId?: string;
  type: RiskFlagType;
  severity: RiskSeverity;
  score: number;
  action: RiskAction;
  dedupeKey: string;
  details?: Record<string, unknown>;
}

const isUnique = (e: unknown) => (e as { code?: string })?.code === 'P2002';
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const daysAgo = (d: number) => hoursAgo(d * 24);

/**
 * Anti-fraud. Risk controls restrict *behaviour* (verification, limits, suspension, human review).
 * CashMouver never uses deposits or custody as a control.
 */
export class RiskService {
  /** Creates a flag once per dedupeKey. Returns true when new. */
  async flag(input: FlagInput): Promise<boolean> {
    try {
      await prisma.riskFlag.create({
        data: { ...input, details: (input.details ?? {}) as Prisma.InputJsonValue },
      });
      logger.warn('risk flag raised', { type: input.type, severity: input.severity, userId: input.userId });
      return true;
    } catch (e) {
      if (isUnique(e)) return false;
      throw e;
    }
  }

  /** Amount of `currency` in EUR minor units, or null when no reference rate exists. */
  async toEurMinor(currency: string, minor: bigint): Promise<bigint | null> {
    if (currency === 'EUR') return minor;
    try {
      const [from, to] = await Promise.all([currencyService.minorUnit(currency), currencyService.minorUnit('EUR')]);
      const { rateScaled } = await exchangeRateService.getRateScaled(currency, 'EUR');
      return convertMinor(minor, from, to, rateScaled);
    } catch {
      return null;
    }
  }

  /** Hard gate used by offer creation and swap requests. */
  async assertCanTrade(user: Pick<User, 'id' | 'tradingRestricted' | 'idVerified' | 'verificationStatus'>): Promise<void> {
    if (user.tradingRestricted) throw new RiskBlockedError('Trading is currently restricted on your account');
    const blocking = await prisma.riskFlag.findFirst({
      where: { userId: user.id, status: { in: ['OPEN', 'REVIEWING', 'ACTIONED'] }, action: { in: ['SUSPEND_TRADING', 'REQUIRE_VERIFICATION'] } },
    });
    if (!blocking) return;
    if (blocking.action === 'SUSPEND_TRADING') throw new RiskBlockedError('Trading is suspended pending review');
    if (!(user.idVerified && user.verificationStatus === 'VERIFIED')) throw new VerificationRequiredError('Identity verification is required to continue trading');
  }

  /** Checked when a swap is requested (before reserving anything). May block. */
  async evaluateSwapRequest(user: User, haveCurrency: string, haveMinor: bigint): Promise<void> {
    const verified = user.idVerified && user.verificationStatus === 'VERIFIED';

    // Rapid activity.
    const velocityLimit = await systemConfig.getInt('risk.swapVelocity1h');
    const recent = await prisma.swap.count({ where: { initiatorId: user.id, createdAt: { gte: hoursAgo(1) } } });
    if (recent + 1 > velocityLimit) {
      await this.flag({ userId: user.id, type: 'RAPID_ACTIVITY', severity: 'HIGH', score: 70, action: 'REQUIRE_REVIEW', dedupeKey: `rapid:${user.id}:${new Date().toISOString().slice(0, 13)}`, details: { recent } });
      throw new RiskBlockedError('You are creating swap requests unusually fast. Please try again later.');
    }

    // Unusually large exchange.
    const eur = await this.toEurMinor(haveCurrency, haveMinor);
    const largeThreshold = BigInt(await systemConfig.getInt('risk.largeExchangeEur'));
    if (eur !== null && eur >= largeThreshold) {
      await this.flag({ userId: user.id, type: 'LARGE_EXCHANGE', severity: 'MEDIUM', score: 50, action: verified ? 'REQUIRE_REVIEW' : 'REQUIRE_VERIFICATION', dedupeKey: `large:${user.id}:${new Date().toISOString().slice(0, 10)}:${haveCurrency}`, details: { haveCurrency, eurMinor: eur.toString() } });
      if (!verified) throw new VerificationRequiredError('Identity verification is required for exchanges of this size');
    }
  }

  async onSwapCancelled(userId: string): Promise<void> {
    const threshold = await systemConfig.getInt('risk.cancelThreshold7d');
    const n = await prisma.swapEvent.count({ where: { actorId: userId, eventType: 'CANCELLED', createdAt: { gte: daysAgo(7) } } });
    if (n >= threshold) {
      await this.flag({ userId, type: 'REPEATED_CANCELLATIONS', severity: 'MEDIUM', score: 40, action: 'REQUIRE_REVIEW', dedupeKey: `cancel:${userId}:${new Date().toISOString().slice(0, 10)}`, details: { cancellations7d: n } });
    }
  }

  async onDisputeAgainst(userId: string): Promise<void> {
    const threshold = await systemConfig.getInt('risk.disputeThreshold30d');
    const n = await prisma.dispute.count({ where: { againstId: userId, createdAt: { gte: daysAgo(30) } } });
    if (n >= threshold) {
      await this.flag({ userId, type: 'REPEATED_DISPUTES', severity: 'HIGH', score: 65, action: 'REQUIRE_REVIEW', dedupeKey: `disputes:${userId}:${new Date().toISOString().slice(0, 10)}`, details: { disputes30d: n } });
    }
  }

  async onDeviceSeen(userId: string, deviceHash: string): Promise<void> {
    const others = await prisma.loginDevice.findMany({ where: { deviceHash, userId: { not: userId } }, select: { userId: true }, take: 10 });
    if (others.length >= 2) {
      await this.flag({ userId, type: 'MULTIPLE_ACCOUNTS_DEVICE', severity: 'MEDIUM', score: 55, action: 'REQUIRE_REVIEW', dedupeKey: `device:${userId}:${deviceHash.slice(0, 12)}`, details: { sharedWithAccounts: others.length } });
    }
  }

  /** Same user posting offers from a different country within a day. */
  async onOfferLocation(userId: string, country: string): Promise<void> {
    const prev = await prisma.swapOffer.findFirst({ where: { userId, createdAt: { gte: hoursAgo(24) }, country: { not: country } }, select: { country: true } });
    if (prev) {
      await this.flag({ userId, type: 'SUSPICIOUS_LOCATION_CHANGE', severity: 'LOW', score: 30, action: 'ALLOW', dedupeKey: `loc:${userId}:${new Date().toISOString().slice(0, 10)}:${country}`, details: { from: prev.country, to: country } });
    }
  }

  async onVerificationInconsistency(user: Pick<User, 'id' | 'country'>, documentCountry: string): Promise<void> {
    if (user.country && user.country !== documentCountry) {
      await this.flag({ userId: user.id, type: 'VERIFICATION_INCONSISTENCY', severity: 'LOW', score: 25, action: 'ALLOW', dedupeKey: `verif:${user.id}:${documentCountry}`, details: { profileCountry: user.country, documentCountry } });
    }
  }

  async onPaymentMismatch(userId: string, paymentId: string, problems: string): Promise<void> {
    await this.flag({ userId, type: 'PAYMENT_MISMATCH', severity: 'HIGH', score: 80, action: 'REQUIRE_REVIEW', dedupeKey: `paymismatch:${paymentId}`, details: { problems } });
  }

  // ───────────── admin ─────────────

  async list(status: 'OPEN' | 'REVIEWING' | 'DISMISSED' | 'ACTIONED' | undefined, page: number, perPage: number) {
    const where = status ? { status } : {};
    const [items, total] = await Promise.all([
      prisma.riskFlag.findMany({ where, orderBy: [{ createdAt: 'desc' }], skip: (page - 1) * perPage, take: perPage, include: { reviews: true } }),
      prisma.riskFlag.count({ where }),
    ]);
    return { items, total };
  }

  async review(flagId: string, reviewerId: string, decision: RiskAction | 'DISMISS', note?: string) {
    const flag = await prisma.riskFlag.findUnique({ where: { id: flagId } });
    if (!flag) throw new NotFoundError('Flag not found');
    if (flag.status === 'DISMISSED' || flag.status === 'ACTIONED') throw new BadRequestError('Flag already reviewed');
    if (decision !== 'ALLOW' && decision !== 'DISMISS' && (!note || note.trim().length < 5)) throw new BadRequestError('A note is required when taking action');

    const action: RiskAction = decision === 'DISMISS' ? 'ALLOW' : decision;
    const claimed = await prisma.riskFlag.updateMany({ where: { id: flagId, status: { in: ['OPEN', 'REVIEWING'] } }, data: { status: decision === 'DISMISS' || action === 'ALLOW' ? 'DISMISSED' : 'ACTIONED', action } });
    if (claimed.count !== 1) throw new BadRequestError('Flag already reviewed');
    await prisma.riskReview.create({ data: { flagId, reviewerId, decision: action, note } });

    if (flag.userId) {
      if (action === 'SUSPEND_TRADING') await prisma.user.update({ where: { id: flag.userId }, data: { tradingRestricted: true } });
      if (action === 'SUSPEND_OFFER') await prisma.swapOffer.updateMany({ where: { userId: flag.userId, status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    }
    await auditService.record({ actorId: reviewerId, action: `risk.${decision.toLowerCase()}`, targetType: 'RiskFlag', targetId: flagId, before: { status: flag.status, action: flag.action }, after: { action }, reason: note });
  }
}

export const riskService = new RiskService();
