import cron, { ScheduledTask } from 'node-cron';
import crypto from 'crypto';
import { prisma } from '@/config/database';
import logger from '@/utils/logger.util';
import { offerService } from '@/services/offer.service';
import { swapService } from '@/services/swap.service';
import { reservationService } from '@/services/reservation.service';
import { promotionService } from '@/services/promotion.service';
import { adService } from '@/services/ad.service';
import { subscriptionService } from '@/services/subscription.service';
import { referralService } from '@/services/referral.service';
import { verificationService } from '@/services/verification.service';
import { phoneService } from '@/services/phone.service';
import { sessionService } from '@/services/session.service';
import { notificationService } from '@/services/notification.service';
import { apiKeyService } from '@/services/apikey.service';
import { marketService } from '@/services/market.service';
import { exchangeRateService } from '@/services/exchangeRate.service';
import { rateAlertService } from '@/services/ratealert.service';
import { disputeService } from '@/services/dispute.service';

const INSTANCE = crypto.randomUUID();

export interface JobDef {
  name: string;
  schedule: string;
  /** Lease length: another instance may take over if this one dies mid-run. */
  leaseSeconds: number;
  run: () => Promise<unknown>;
}

/**
 * Cluster-safe lease on a named job. Only one instance runs a job at a time;
 * the lease self-expires so a crashed instance never blocks the job forever.
 * Every job body is idempotent, so an overlap after lease expiry is harmless.
 */
export async function acquireLease(name: string, leaseSeconds: number, now = new Date()): Promise<boolean> {
  const until = new Date(now.getTime() + leaseSeconds * 1000);
  const taken = await prisma.jobLock.updateMany({ where: { name, lockedUntil: { lt: now } }, data: { lockedUntil: until, lockedBy: INSTANCE } });
  if (taken.count === 1) return true;
  try {
    await prisma.jobLock.create({ data: { name, lockedUntil: until, lockedBy: INSTANCE } });
    return true;
  } catch {
    return false; // unique violation: someone else holds it
  }
}

async function releaseLease(name: string): Promise<void> {
  await prisma.jobLock.updateMany({ where: { name, lockedBy: INSTANCE }, data: { lockedUntil: new Date(0), lastRunAt: new Date() } });
}

export async function runJob(job: JobDef): Promise<void> {
  if (!(await acquireLease(job.name, job.leaseSeconds))) return;
  const started = Date.now();
  try {
    const result = await job.run();
    logger.info('job finished', { job: job.name, ms: Date.now() - started, result: typeof result === 'number' ? result : undefined });
  } catch (error) {
    logger.error('job failed', { job: job.name, message: (error as Error).message });
  } finally {
    await releaseLease(job.name).catch(() => undefined);
  }
}

export const JOBS: JobDef[] = [
  // Offers and swaps: correctness never depends on these (APIs reject expired offers immediately), they only tidy state and notify.
  { name: 'offers.expire', schedule: '* * * * *', leaseSeconds: 55, run: () => offerService.expireElapsed() },
  { name: 'offers.expiringSoon', schedule: '*/15 * * * *', leaseSeconds: 600, run: () => offerService.notifyExpiringSoon() },
  { name: 'swaps.expire', schedule: '* * * * *', leaseSeconds: 55, run: () => swapService.expireElapsed() },
  { name: 'swaps.reminders', schedule: '*/10 * * * *', leaseSeconds: 300, run: () => swapService.sendReminders() },
  { name: 'swaps.repairCompletions', schedule: '*/5 * * * *', leaseSeconds: 240, run: () => swapService.repairCompletions() },
  { name: 'reservations.reconcile', schedule: '17 * * * *', leaseSeconds: 900, run: () => reservationService.reconcileAll() },

  // Paid services
  { name: 'promotions.expire', schedule: '* * * * *', leaseSeconds: 55, run: () => promotionService.expireElapsed() },
  { name: 'ads.end', schedule: '*/5 * * * *', leaseSeconds: 240, run: () => adService.endElapsed() },
  { name: 'subscriptions.expireLapsed', schedule: '*/10 * * * *', leaseSeconds: 300, run: () => subscriptionService.expireLapsed() },
  { name: 'subscriptions.notifyExpiring', schedule: '0 9 * * *', leaseSeconds: 1800, run: () => subscriptionService.notifyExpiring() },
  { name: 'referrals.release', schedule: '*/30 * * * *', leaseSeconds: 900, run: () => referralService.releaseDueRewards() },

  // Verification and data hygiene
  { name: 'verification.expire', schedule: '15 2 * * *', leaseSeconds: 1800, run: () => verificationService.expireOutdated() },
  { name: 'verification.purgeDocuments', schedule: '30 2 * * *', leaseSeconds: 3600, run: () => verificationService.purgeExpiredDocuments() },
  { name: 'otp.purge', schedule: '*/30 * * * *', leaseSeconds: 600, run: () => phoneService.purgeExpired() },
  { name: 'sessions.purge', schedule: '45 2 * * *', leaseSeconds: 1800, run: () => sessionService.purgeExpired() },
  { name: 'notifications.purge', schedule: '0 3 * * *', leaseSeconds: 1800, run: () => notificationService.purgeOld(90) },
  { name: 'api.resetMonthly', schedule: '5 0 1 * *', leaseSeconds: 1800, run: () => apiKeyService.resetMonthlyCounters() },

  // Market data
  { name: 'rates.refresh', schedule: '*/30 * * * *', leaseSeconds: 600, run: () => exchangeRateService.refreshRates() },
  { name: 'rates.purge', schedule: '20 3 * * *', leaseSeconds: 1800, run: () => exchangeRateService.purgeOld(400) },
  { name: 'rateAlerts.evaluate', schedule: '*/5 * * * *', leaseSeconds: 240, run: () => rateAlertService.evaluateAll() },
  { name: 'market.aggregate', schedule: '10 * * * *', leaseSeconds: 900, run: () => marketService.aggregateToday() },
  { name: 'market.purge', schedule: '40 3 * * 0', leaseSeconds: 1800, run: () => marketService.purgeOld(800) },

  // Disputes
  { name: 'disputes.autoClose', schedule: '0 * * * *', leaseSeconds: 600, run: () => disputeService.autoCloseResolved() },
];

const tasks: ScheduledTask[] = [];

export function startScheduler(): void {
  for (const job of JOBS) {
    tasks.push(cron.schedule(job.schedule, () => void runJob(job), { timezone: 'UTC' }));
  }
  logger.info(`Scheduler started with ${JOBS.length} jobs`);
}

export function stopScheduler(): void {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}
