import { newDb } from '../helpers/fake-db';

const db = newDb();
jest.mock('@/config/database', () => ({ prisma: db, default: db }));
jest.mock('@/config/redis', () => require('../helpers/mock-infra').redisStub());
jest.mock('@/services/notification.service', () => ({ notificationService: { notify: jest.fn(async () => 'n') }, NOTIFICATION_ROUTES: {} }));
jest.mock('@/services/referral.service', () => ({ referralService: { onQualifyingEvent: jest.fn(async () => undefined) } }));
jest.mock('@/services/rating.service', () => ({ ratingService: { recomputeTrust: jest.fn(async () => undefined), rate: jest.fn(async () => ({})) } }));
jest.mock('@/services/market.service', () => ({ marketService: { recordCompletedSwap: jest.fn(async () => undefined) } }));
jest.mock('@/services/activity.service', () => ({ logActivity: jest.fn(async () => undefined) }));
jest.mock('@/services/risk.service', () => ({ riskService: {} }));
jest.mock('@/services/message.service', () => ({ messageService: { createSystemOrFirst: jest.fn(async () => undefined) } }));
jest.mock('@/services/meetup.service', () => ({ meetupService: {} }));

import { swapService } from '@/services/swap.service';
import { notificationService } from '@/services/notification.service';
import { referralService } from '@/services/referral.service';
import { marketService } from '@/services/market.service';
import { InvalidStateError, NotFoundError } from '@/utils/error.util';

const hours = (n: number) => new Date(Date.now() + n * 3600_000);

function setup(status = 'IN_PROGRESS') {
  db.tables.clear();
  const a = db.seed('user', { name: 'Alice Martin', email: 'a@x.eu', totalSwaps: 0, successfulSwaps: 0 });
  const b = db.seed('user', { name: 'Bruno Keller', email: 'b@x.eu', totalSwaps: 0, successfulSwaps: 0 });
  const offer = db.seed('swapOffer', { userId: b.id, status: 'ACTIVE', availableUntil: hours(24), haveTotalMinor: 100_000n, remainingMinor: 0n, reservedMinor: 100_000n, consumedMinor: 0n });
  const swap = db.seed('swap', { initiatorId: a.id, receiverId: b.id, offerId: offer.id, status, haveCurrency: 'EUR', wantCurrency: 'USD', initiatorConfirmed: false, receiverConfirmed: false, expiresAt: hours(24) });
  db.seed('offerReservation', { offerId: offer.id, swapId: swap.id, amountMinor: 100_000n, status: 'HELD', expiresAt: hours(24) });
  return { a, b, offer, swap };
}
const events = (type: string) => db.rows('swapEvent').filter((e) => e.eventType === type);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(swapService, 'getForUser').mockResolvedValue({} as never);
});

describe('swap completion is exactly-once', () => {
  it('both parties confirming simultaneously completes the swap once and applies side effects once', async () => {
    const { a, b, swap, offer } = setup();
    await Promise.all([swapService.confirm(a.id, swap.id), swapService.confirm(b.id, swap.id)]);

    expect(swap.status).toBe('COMPLETED');
    expect(events('COMPLETED')).toHaveLength(1);
    expect(a.totalSwaps).toBe(1);
    expect(b.totalSwaps).toBe(1);
    expect(a.successfulSwaps).toBe(1);
    expect(offer.consumedMinor).toBe(100_000n);
    expect(offer.reservedMinor).toBe(0n);
    expect(marketService.recordCompletedSwap).toHaveBeenCalledTimes(1);
    expect((notificationService.notify as jest.Mock).mock.calls.filter(([n]) => n.type === 'SWAP_COMPLETED')).toHaveLength(2);
    expect((referralService.onQualifyingEvent as jest.Mock).mock.calls.filter(([, action]) => action === 'FIRST_COMPLETED_SWAP')).toHaveLength(2);
  });

  it('many racing confirmations and replays still count once', async () => {
    const { a, b, swap } = setup();
    await Promise.all([swapService.confirm(a.id, swap.id), swapService.confirm(b.id, swap.id), swapService.confirm(a.id, swap.id), swapService.confirm(b.id, swap.id)]);
    await swapService.confirm(a.id, swap.id); // late replay after completion
    expect(a.totalSwaps).toBe(1);
    expect(b.totalSwaps).toBe(1);
    expect(events('COMPLETED')).toHaveLength(1);
  });

  it('one confirmation alone does not complete the swap', async () => {
    const { a, swap } = setup();
    await swapService.confirm(a.id, swap.id);
    expect(swap.status).toBe('CONFIRMING');
    expect(swap.initiatorConfirmed).toBe(true);
    expect(swap.receiverConfirmed).toBe(false);
    expect(events('COMPLETED')).toHaveLength(0);
  });

  it('the recovery job re-applying side effects is a no-op', async () => {
    const { a, b, swap } = setup();
    await Promise.all([swapService.confirm(a.id, swap.id), swapService.confirm(b.id, swap.id)]);
    await swapService.applySideEffects(swap.id);
    await swapService.applySideEffects(swap.id);
    expect(a.totalSwaps).toBe(1);
    expect(marketService.recordCompletedSwap).toHaveBeenCalledTimes(1);
  });

  it('a crash after COMPLETED but before side effects is repaired exactly once', async () => {
    const { a, b, swap } = setup('COMPLETED'); // status flipped, but nothing else happened
    await Promise.all([swapService.applySideEffects(swap.id), swapService.applySideEffects(swap.id)]);
    expect(a.totalSwaps).toBe(1);
    expect(b.totalSwaps).toBe(1);
  });

  it('cannot confirm a swap that is not in progress', async () => {
    const { a, swap } = setup('PENDING');
    await expect(swapService.confirm(a.id, swap.id)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('cannot confirm a cancelled swap', async () => {
    const { a, swap } = setup('CANCELLED');
    await expect(swapService.confirm(a.id, swap.id)).rejects.toBeInstanceOf(InvalidStateError);
  });

  it('a stranger cannot confirm (and learns nothing about the swap): NotFound, not Forbidden', async () => {
    const { swap } = setup();
    const stranger = db.seed('user', { name: 'Mallory', email: 'm@x.eu' });
    await expect(swapService.confirm(stranger.id, swap.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(swap.initiatorConfirmed).toBe(false);
  });

  it('immutable event history: events are only ever appended', async () => {
    const { a, b, swap } = setup();
    await Promise.all([swapService.confirm(a.id, swap.id), swapService.confirm(b.id, swap.id)]);
    const keys = db.rows('swapEvent').map((e) => e.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
