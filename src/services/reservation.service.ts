import type { Prisma } from '@prisma/client';
import { prisma } from '@/config/database';
import { InsufficientAvailabilityError, OfferUnavailableError } from '@/utils/error.util';
import logger from '@/utils/logger.util';

/**
 * Offer inventory reservation — NOT custody of money. It only stops one offer
 * being promised to several people beyond the amount its owner listed.
 *
 * Invariant per offer:   remaining + reserved + consumed == total
 *
 * Every mutation is a single conditional `updateMany` (atomic per MongoDB
 * document), so two requests racing for the last slice cannot both succeed.
 */
export class ReservationService {
  /**
   * Atomically moves `amount` from remaining → reserved if (and only if) the
   * offer is still ACTIVE, unexpired and has enough left. Throws otherwise.
   */
  async reserve(offerId: string, amount: bigint): Promise<void> {
    const now = new Date();
    const r = await prisma.swapOffer.updateMany({
      where: { id: offerId, status: 'ACTIVE', availableUntil: { gt: now }, remainingMinor: { gte: amount } },
      data: { remainingMinor: { decrement: amount }, reservedMinor: { increment: amount } },
    });
    if (r.count === 1) return;

    const offer = await prisma.swapOffer.findUnique({ where: { id: offerId }, select: { status: true, availableUntil: true, remainingMinor: true } });
    if (!offer || offer.status !== 'ACTIVE' || offer.availableUntil <= now) throw new OfferUnavailableError();
    throw new InsufficientAvailabilityError(undefined, { availableMinor: offer.remainingMinor.toString() });
  }

  /** Records the reservation row for a swap (unique per swap ⇒ idempotent). */
  async hold(offerId: string, swapId: string, amount: bigint, expiresAt: Date): Promise<void> {
    await prisma.offerReservation.create({ data: { offerId, swapId, amountMinor: amount, expiresAt } });
  }

  /** Undo a `reserve` whose swap/reservation row could not be created. */
  async unreserve(offerId: string, amount: bigint): Promise<void> {
    await prisma.swapOffer.updateMany({ where: { id: offerId }, data: { remainingMinor: { increment: amount }, reservedMinor: { decrement: amount } } });
  }

  /**
   * HELD → RELEASED/EXPIRED (cancel, reject, expiry). Exactly-once: only the
   * caller that flips the reservation status touches the offer counters.
   */
  async release(swapId: string, status: 'RELEASED' | 'EXPIRED' = 'RELEASED'): Promise<boolean> {
    const res = await prisma.offerReservation.findUnique({ where: { swapId } });
    if (!res) return false;
    const claimed = await prisma.offerReservation.updateMany({ where: { id: res.id, status: 'HELD' }, data: { status, releasedAt: new Date() } });
    if (claimed.count !== 1) return false;
    await prisma.swapOffer.updateMany({ where: { id: res.offerId }, data: { remainingMinor: { increment: res.amountMinor }, reservedMinor: { decrement: res.amountMinor } } });
    return true;
  }

  /** HELD → CONSUMED on completion. Closes the offer when nothing remains. */
  async consume(swapId: string): Promise<boolean> {
    const res = await prisma.offerReservation.findUnique({ where: { swapId } });
    if (!res) return false;
    const claimed = await prisma.offerReservation.updateMany({ where: { id: res.id, status: 'HELD' }, data: { status: 'CONSUMED', consumedAt: new Date() } });
    if (claimed.count !== 1) return false;
    await prisma.swapOffer.updateMany({ where: { id: res.offerId }, data: { reservedMinor: { decrement: res.amountMinor }, consumedMinor: { increment: res.amountMinor } } });
    await prisma.swapOffer.updateMany({ where: { id: res.offerId, status: 'ACTIVE', remainingMinor: 0n, reservedMinor: 0n }, data: { status: 'COMPLETED' } });
    return true;
  }

  async extend(swapId: string, expiresAt: Date): Promise<void> {
    await prisma.offerReservation.updateMany({ where: { swapId, status: 'HELD' }, data: { expiresAt } });
  }

  /**
   * Safety net: rebuild an offer's counters from its reservation rows. Run by a
   * job for offers whose counters drifted (e.g. a crash between two writes).
   */
  async reconcileOffer(offerId: string): Promise<boolean> {
    const offer = await prisma.swapOffer.findUnique({ where: { id: offerId } });
    if (!offer) return false;
    const rows = await prisma.offerReservation.groupBy({ by: ['status'], where: { offerId }, _sum: { amountMinor: true } });
    const sum = (s: string) => rows.find((r) => r.status === s)?._sum.amountMinor ?? 0n;
    const reserved = sum('HELD');
    const consumed = sum('CONSUMED');
    const remaining = offer.haveTotalMinor - reserved - consumed;
    if (remaining < 0n) {
      logger.error('offer over-reserved; manual review required', { offerId });
      return false;
    }
    if (reserved === offer.reservedMinor && consumed === offer.consumedMinor && remaining === offer.remainingMinor) return false;
    // Only apply if nothing changed since we read it.
    const data: Prisma.SwapOfferUpdateManyMutationInput = { reservedMinor: reserved, consumedMinor: consumed, remainingMinor: remaining };
    const r = await prisma.swapOffer.updateMany({ where: { id: offerId, reservedMinor: offer.reservedMinor, consumedMinor: offer.consumedMinor, remainingMinor: offer.remainingMinor }, data });
    if (r.count === 1) logger.warn('offer counters reconciled', { offerId });
    return r.count === 1;
  }

  /** Job: reconcile offers that are live or changed recently. Returns the number of corrected offers. */
  async reconcileAll(now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - 24 * 3600_000);
    const offers = await prisma.swapOffer.findMany({ where: { OR: [{ status: 'ACTIVE' }, { updatedAt: { gte: since } }] }, select: { id: true }, take: 2000 });
    let fixed = 0;
    for (const o of offers) if (await this.reconcileOffer(o.id)) fixed++;
    return fixed;
  }
}

export const reservationService = new ReservationService();
