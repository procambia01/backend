import { newDb } from '../helpers/fake-db';

const db = newDb();
jest.mock('@/config/database', () => ({ prisma: db, default: db }));
jest.mock('@/config/redis', () => require('../helpers/mock-infra').redisStub());

import { reservationService } from '@/services/reservation.service';
import { OfferUnavailableError, InsufficientAvailabilityError } from '@/utils/error.util';

const hours = (n: number) => new Date(Date.now() + n * 3600_000);
const offer = (o: Record<string, unknown> = {}) =>
  db.seed('swapOffer', { status: 'ACTIVE', availableUntil: hours(24), haveTotalMinor: 1_000_000n, remainingMinor: 1_000_000n, reservedMinor: 0n, consumedMinor: 0n, ...o });
const invariant = (id: string) => {
  const o = db.rows('swapOffer').find((r) => r.id === id)!;
  return o.remainingMinor + o.reservedMinor + o.consumedMinor === o.haveTotalMinor && o.remainingMinor >= 0n && o.reservedMinor >= 0n;
};

beforeEach(() => db.tables.clear());

describe('offer reservation (inventory, not custody)', () => {
  it('reserves and reduces remaining availability', async () => {
    const o = offer();
    await reservationService.reserve(o.id, 300_000n);
    expect(o.remainingMinor).toBe(700_000n);
    expect(o.reservedMinor).toBe(300_000n);
    expect(invariant(o.id)).toBe(true);
  });

  it('refuses to reserve more than what is left', async () => {
    const o = offer({ remainingMinor: 100n, reservedMinor: 999_900n });
    await expect(reservationService.reserve(o.id, 101n)).rejects.toBeInstanceOf(InsufficientAvailabilityError);
    expect(o.remainingMinor).toBe(100n);
  });

  it('rejects an expired offer immediately, even if no job has marked it EXPIRED', async () => {
    const o = offer({ status: 'ACTIVE', availableUntil: new Date(Date.now() - 1000) });
    await expect(reservationService.reserve(o.id, 10n)).rejects.toBeInstanceOf(OfferUnavailableError);
    expect(o.reservedMinor).toBe(0n);
  });

  it.each(['PAUSED', 'CANCELLED', 'EXPIRED', 'COMPLETED'])('rejects a %s offer', async (status) => {
    const o = offer({ status });
    await expect(reservationService.reserve(o.id, 10n)).rejects.toBeInstanceOf(OfferUnavailableError);
  });

  it('many simultaneous takers can never over-reserve', async () => {
    const o = offer({ haveTotalMinor: 10_000n, remainingMinor: 10_000n });
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => reservationService.reserve(o.id, 1_000n)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(15);
    expect(o.remainingMinor).toBe(0n);
    expect(o.reservedMinor).toBe(10_000n);
    expect(invariant(o.id)).toBe(true);
  });

  it('release returns the slice exactly once', async () => {
    const o = offer();
    await reservationService.reserve(o.id, 400_000n);
    await reservationService.hold(o.id, 'swap1', 400_000n, hours(2));
    const results = await Promise.all([reservationService.release('swap1'), reservationService.release('swap1'), reservationService.release('swap1')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(o.remainingMinor).toBe(1_000_000n);
    expect(o.reservedMinor).toBe(0n);
    expect(invariant(o.id)).toBe(true);
  });

  it('consume moves reserved → consumed exactly once and completes a sold-out offer', async () => {
    const o = offer({ haveTotalMinor: 500n, remainingMinor: 500n });
    await reservationService.reserve(o.id, 500n);
    await reservationService.hold(o.id, 'swap1', 500n, hours(2));
    const results = await Promise.all([reservationService.consume('swap1'), reservationService.consume('swap1')]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(o.consumedMinor).toBe(500n);
    expect(o.reservedMinor).toBe(0n);
    expect(o.status).toBe('COMPLETED');
    expect(invariant(o.id)).toBe(true);
  });

  it('a released reservation cannot later be consumed', async () => {
    const o = offer();
    await reservationService.reserve(o.id, 100n);
    await reservationService.hold(o.id, 'swap1', 100n, hours(2));
    await reservationService.release('swap1');
    expect(await reservationService.consume('swap1')).toBe(false);
    expect(o.consumedMinor).toBe(0n);
    expect(invariant(o.id)).toBe(true);
  });

  it('reconcile repairs drifted counters from the reservation rows', async () => {
    const o = offer({ remainingMinor: 1_000_000n, reservedMinor: 0n }); // drift: a HELD row exists but counters were not updated
    db.seed('offerReservation', { offerId: o.id, swapId: 's1', amountMinor: 250_000n, status: 'HELD', expiresAt: hours(1) });
    expect(await reservationService.reconcileOffer(o.id)).toBe(true);
    expect(o.reservedMinor).toBe(250_000n);
    expect(o.remainingMinor).toBe(750_000n);
    expect(invariant(o.id)).toBe(true);
  });

  it('reconcile never fabricates negative availability', async () => {
    const o = offer({ haveTotalMinor: 100n, remainingMinor: 0n, reservedMinor: 100n });
    db.seed('offerReservation', { offerId: o.id, swapId: 's1', amountMinor: 300n, status: 'HELD', expiresAt: hours(1) });
    expect(await reservationService.reconcileOffer(o.id)).toBe(false);
    expect(o.remainingMinor).toBe(0n);
  });
});
