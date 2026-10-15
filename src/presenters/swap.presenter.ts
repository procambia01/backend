import type { Meetup, Swap, User } from '@prisma/client';
import type { MeetupDto, SwapAction, SwapDto } from '@/contracts';
import { fromGeoPoint } from '@/lib/geo';
import { fromMinor, scaledToRate } from '@/lib/money';
import { toPublicUser } from './user.presenter';
import type { UnitMap } from './offer.presenter';

export type SwapRole = 'INITIATOR' | 'RECEIVER';

export function roleOf(swap: Pick<Swap, 'initiatorId' | 'receiverId'>, userId: string): SwapRole | null {
  return swap.initiatorId === userId ? 'INITIATOR' : swap.receiverId === userId ? 'RECEIVER' : null;
}

/**
 * Exact venue details are visible only to the two participants AND only once
 * the meetup has been accepted (or later). Before that, only the approximate
 * address is shared.
 */
export function toMeetupDto(m: Meetup, swap: Pick<Swap, 'initiatorId' | 'receiverId'>, viewerId: string): MeetupDto {
  const role = roleOf(swap, viewerId);
  const isInitiator = role === 'INITIATOR';
  const revealed = !!role && ['ACCEPTED', 'RESCHEDULED', 'COMPLETED'].includes(m.status);
  const loc = revealed ? fromGeoPoint(m.location) : null;
  return {
    id: m.id,
    swapId: m.swapId,
    status: m.status,
    proposedByMe: m.proposedById === viewerId,
    locationName: m.locationName,
    approximateAddress: m.approximateAddress,
    exactAddress: revealed ? m.exactAddress : null,
    privateNotes: revealed ? m.privateNotes : null,
    latitude: loc?.latitude ?? null,
    longitude: loc?.longitude ?? null,
    scheduledAt: m.scheduledAt.toISOString(),
    myConfirmed: isInitiator ? m.initiatorConfirmed : m.receiverConfirmed,
    otherConfirmed: isInitiator ? m.receiverConfirmed : m.initiatorConfirmed,
    myCheckedInAt: (isInitiator ? m.initiatorCheckedInAt : m.receiverCheckedInAt)?.toISOString() ?? null,
    otherCheckedInAt: (isInitiator ? m.receiverCheckedInAt : m.initiatorCheckedInAt)?.toISOString() ?? null,
    myCheckedOutAt: (isInitiator ? m.initiatorCheckedOutAt : m.receiverCheckedOutAt)?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export function allowedActions(swap: Swap, role: SwapRole, opts: { meetup: Meetup | null; hasRated: boolean; now?: Date }): SwapAction[] {
  const now = opts.now ?? new Date();
  const out: SwapAction[] = [];
  const expired = swap.expiresAt <= now && ['PENDING', 'AGREED'].includes(swap.status);
  switch (swap.status) {
    case 'PENDING':
      if (!expired && role === 'RECEIVER') out.push('ACCEPT', 'REJECT');
      out.push('CANCEL');
      if (!expired) out.push('EXTEND');
      break;
    case 'AGREED':
      out.push('CANCEL');
      if (!expired) out.push('PROPOSE_MEETUP', 'EXTEND');
      break;
    case 'IN_PROGRESS':
      out.push('PROPOSE_MEETUP', 'CONFIRM', 'DISPUTE');
      break;
    case 'CONFIRMING': {
      const mine = role === 'INITIATOR' ? swap.initiatorConfirmed : swap.receiverConfirmed;
      if (!mine) out.push('CONFIRM');
      out.push('DISPUTE');
      break;
    }
    case 'COMPLETED':
      if (!opts.hasRated) out.push('RATE');
      break;
    default:
      break;
  }
  return out;
}

export function toSwapDto(
  swap: Swap,
  ctx: { viewerId: string; initiator: User; receiver: User; meetup: Meetup | null; hasRated: boolean; units: UnitMap; unreadMessages?: number }
): SwapDto {
  const role = roleOf(swap, ctx.viewerId) ?? 'INITIATOR';
  const hu = ctx.units.get(swap.haveCurrency);
  const wu = ctx.units.get(swap.wantCurrency);
  const iAmInitiator = role === 'INITIATOR';
  return {
    id: swap.id,
    status: swap.status,
    offerId: swap.offerId,
    initiator: toPublicUser(ctx.initiator),
    receiver: toPublicUser(ctx.receiver),
    haveCurrency: swap.haveCurrency,
    wantCurrency: swap.wantCurrency,
    requested: { haveAmount: fromMinor(swap.requestedHaveMinor, hu), wantAmount: fromMinor(swap.requestedWantMinor, wu), exchangeRate: scaledToRate(swap.requestedRateScaled) },
    agreed:
      swap.agreedHaveMinor !== null && swap.agreedWantMinor !== null && swap.agreedRateScaled !== null && swap.agreedAt
        ? { haveAmount: fromMinor(swap.agreedHaveMinor, hu), wantAmount: fromMinor(swap.agreedWantMinor, wu), exchangeRate: scaledToRate(swap.agreedRateScaled), agreedAt: swap.agreedAt.toISOString() }
        : null,
    iAm: role,
    myConfirmed: iAmInitiator ? swap.initiatorConfirmed : swap.receiverConfirmed,
    otherConfirmed: iAmInitiator ? swap.receiverConfirmed : swap.initiatorConfirmed,
    meetup: ctx.meetup ? toMeetupDto(ctx.meetup, swap, ctx.viewerId) : null,
    expiresAt: swap.expiresAt.toISOString(),
    createdAt: swap.createdAt.toISOString(),
    completedAt: swap.completedAt?.toISOString() ?? null,
    cancelledAt: swap.cancelledAt?.toISOString() ?? null,
    cancellationReason: swap.cancellationReason,
    allowedActions: allowedActions(swap, role, { meetup: ctx.meetup, hasRated: ctx.hasRated }),
    unreadMessages: ctx.unreadMessages,
  };
}
