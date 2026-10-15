import type { SwapOffer, User } from '@prisma/client';
import type { OfferDto } from '@/contracts';
import { fromGeoPoint } from '@/lib/geo';
import { convertMinor, fromMinor, scaledToRate } from '@/lib/money';
import { toPublicUser } from './user.presenter';

export interface UnitMap {
  get(code: string): number;
}

export interface OfferPresentOpts {
  viewerId?: string | null;
  distanceKm?: number;
  units: UnitMap;
  sponsored?: boolean;
}

/**
 * Public representation of an offer. Deliberately has no access to
 * `privateLocation`, owner email/phone or any KYC data.
 */
export function toOfferDto(o: SwapOffer, owner: User, opts: OfferPresentOpts): OfferDto {
  const hu = opts.units.get(o.haveCurrency);
  const wu = opts.units.get(o.wantCurrency);
  const area = fromGeoPoint(o.area) ?? { latitude: 0, longitude: 0 };
  const now = Date.now();
  const mine = opts.viewerId === o.userId;
  return {
    id: o.id,
    owner: toPublicUser(owner),
    haveCurrency: o.haveCurrency,
    wantCurrency: o.wantCurrency,
    haveAmount: fromMinor(o.haveTotalMinor, hu),
    availableAmount: fromMinor(o.remainingMinor, hu),
    availableWantAmount: fromMinor(convertMinor(o.remainingMinor, hu, wu, o.rateScaled), wu),
    reservedAmount: fromMinor(o.reservedMinor, hu),
    minSwapAmount: fromMinor(o.minSwapMinor, hu),
    exchangeRate: scaledToRate(o.rateScaled),
    area: { latitude: area.latitude, longitude: area.longitude, label: o.areaLabel ?? o.meetingArea ?? null, radiusKm: o.radiusKm, city: o.city, country: o.country },
    distanceKm: opts.distanceKm,
    availableFrom: o.availableFrom.toISOString(),
    availableUntil: o.availableUntil.toISOString(),
    timeSlots: o.timeSlots,
    notes: o.notes,
    status: o.status,
    visibility: o.visibility,
    requiresVerifiedUsers: o.requiresVerifiedUsers,
    minTrustScore: o.minTrustScore,
    isBoosted: !!o.boostedUntil && o.boostedUntil.getTime() > now,
    isFeatured: !!o.featuredUntil && o.featuredUntil.getTime() > now,
    sponsored: opts.sponsored,
    viewCount: mine ? o.viewCount : 0,
    createdAt: o.createdAt.toISOString(),
    expiresAt: o.expiresAt?.toISOString() ?? null,
    mine: mine || undefined,
    boostedUntil: mine ? (o.boostedUntil?.toISOString() ?? null) : undefined,
    featuredUntil: mine ? (o.featuredUntil?.toISOString() ?? null) : undefined,
  };
}
