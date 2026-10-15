import type { AdCampaign, Boost, FeaturedListing, Payment, ServiceProduct, Subscription, VerificationCase, VerificationDocument } from '@prisma/client';
import type { ApiKeyDto, BoostDto, FeaturedDto, OwnerAdDto, PaymentDto, ServiceProductDto, SubscriptionDto, VerificationCaseDto } from '@/contracts';
import { fromMinor } from '@/lib/money';
import type { UnitMap } from './offer.presenter';

/**
 * Money leaves the API as DECIMAL STRINGS in the currency's own precision.
 * Internal rows keep integer minor units; these functions are the only place
 * the two are converted for responses.
 */
const amt = (minor: number | bigint, currency: string, units: UnitMap) => fromMinor(minor, units.get(currency));

export const toServiceProductDto = (p: ServiceProduct, units: UnitMap): ServiceProductDto => ({
  code: p.code,
  kind: p.kind,
  name: p.name,
  description: p.description,
  amount: amt(p.amountMinor, p.currency, units),
  currency: p.currency,
  interval: p.interval,
  durationHours: p.durationHours,
  planTier: p.planTier,
  placement: p.placement,
  trialDays: p.trialDays,
  features: p.features,
});

export const toPaymentDto = (p: Payment, units: UnitMap): PaymentDto => ({
  id: p.id,
  productCode: p.productCode,
  kind: p.kind,
  amount: amt(p.amountMinor, p.currency, units),
  currency: p.currency,
  status: p.status,
  targetType: p.targetType,
  targetId: p.targetId,
  createdAt: p.createdAt.toISOString(),
  paidAt: p.paidAt?.toISOString() ?? null,
  failureReason: p.failureReason,
  refundedAmount: amt(p.refundedMinor, p.currency, units),
});

export const toSubscriptionDto = (s: Subscription, units: UnitMap): SubscriptionDto => ({
  id: s.id,
  productCode: s.productCode,
  tier: s.tier,
  status: s.status,
  interval: s.interval,
  amount: amt(s.amountMinor, s.currency, units),
  currency: s.currency,
  currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
  cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  trialEnd: s.trialEnd?.toISOString() ?? null,
});

export const toBoostDto = (b: Boost, units: UnitMap): BoostDto => ({
  id: b.id,
  offerId: b.offerId,
  productCode: b.productCode,
  startsAt: b.startsAt.toISOString(),
  endsAt: b.endsAt.toISOString(),
  status: b.status as BoostDto['status'],
  impressions: b.impressions,
  clicks: b.clicks,
  price: amt(b.priceMinor, b.currency, units),
  currency: b.currency,
});

export const toFeaturedDto = (f: FeaturedListing, units: UnitMap): FeaturedDto => ({ ...toBoostDto(f as unknown as Boost, units), placement: f.placement });

export const toOwnerAdDto = (a: AdCampaign): OwnerAdDto => ({
  id: a.id,
  type: a.type,
  placement: a.placement,
  title: a.title,
  body: a.body,
  imageUrl: a.imageUrl,
  targetUrl: a.targetUrl,
  offerId: a.offerId,
  status: a.status,
  startsAt: a.startsAt?.toISOString() ?? null,
  endsAt: a.endsAt?.toISOString() ?? null,
  impressions: a.impressions,
  clicks: a.clicks,
  reviewNote: a.reviewNote,
  currencies: a.currencies,
  countries: a.countries,
  cities: a.cities,
});

export const toVerificationCaseDto = (c: VerificationCase & { documents?: VerificationDocument[] }): VerificationCaseDto => ({
  id: c.id,
  type: c.type,
  tier: c.tier === 'ENHANCED' ? 'ENHANCED' : 'BASIC',
  status: c.status,
  documentType: c.documentType,
  documentCountry: c.documentCountry,
  businessName: c.businessName,
  submittedAt: c.submittedAt.toISOString(),
  reviewedAt: c.reviewedAt?.toISOString() ?? null,
  rejectionReason: c.rejectionReason,
  expiresAt: c.expiresAt?.toISOString() ?? null,
  needsPayment: c.tier === 'ENHANCED' && !c.paymentId && ['SUBMITTED', 'UNDER_REVIEW'].includes(c.status),
  documents: c.documents?.filter((d) => !d.deletedAt).map((d) => ({ id: d.id, kind: d.kind, mimeType: d.mimeType, sizeBytes: d.sizeBytes, uploadedAt: d.uploadedAt.toISOString() })),
});

export const toApiKeyDto = (k: {
  id: string; name: string; keyPrefix: string; scopes: string[]; isActive: boolean; rateLimitPerMinute: number; monthlyQuota: number;
  requestCount: number; lastUsedAt: Date | null; createdAt: Date; expiresAt: Date | null; revokedAt: Date | null;
}): ApiKeyDto => ({
  id: k.id, name: k.name, keyPrefix: k.keyPrefix, scopes: k.scopes, isActive: k.isActive, rateLimitPerMinute: k.rateLimitPerMinute,
  monthlyQuota: k.monthlyQuota, requestCount: k.requestCount, lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  createdAt: k.createdAt.toISOString(), expiresAt: k.expiresAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null,
});
