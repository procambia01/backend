/**
 * @cashmouver/contracts — the single source of truth for the API shape shared
 * by the server, web app and mobile app.
 *
 * This file is dependency-free apart from `zod`. It is copied verbatim to
 * `src/contracts/index.ts` in each project by `scripts/sync-contracts.mjs`
 * (a CI check fails if the copies drift).
 *
 * Money convention: amounts and rates travel as DECIMAL STRINGS
 * ("10500.50", "1.1200000000"). Never parse them with parseFloat for
 * arithmetic — use them for display (Intl) or send them back unchanged.
 */
import { z } from 'zod';

// ───────────────────────── Envelope ─────────────────────────

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}
export interface ApiSuccess<T, M = Record<string, unknown>> {
  success: true;
  data: T;
  meta: M;
  error: null;
}
export interface ApiFailure {
  success: false;
  data: null;
  meta?: Record<string, unknown>;
  error: ApiErrorBody;
}
export type ApiResponse<T, M = Record<string, unknown>> = ApiSuccess<T, M> | ApiFailure;
export type Paginated<T> = ApiSuccess<T[], PageMeta>;

export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'REAUTH_REQUIRED',
  'TWO_FACTOR_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'LIMIT_EXCEEDED',
  'PLAN_REQUIRED',
  'VERIFICATION_REQUIRED',
  'INVALID_STATE',
  'OFFER_UNAVAILABLE',
  'INSUFFICIENT_AVAILABILITY',
  'RATE_MISMATCH',
  'PAYMENT_REQUIRED',
  'PAYMENT_MISMATCH',
  'UPLOAD_INVALID',
  'RISK_BLOCKED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ───────────────────────── Enums ─────────────────────────

export const SWAP_STATUSES = ['PENDING', 'AGREED', 'IN_PROGRESS', 'CONFIRMING', 'COMPLETED', 'CANCELLED', 'DISPUTED'] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];

/** Mirrors the server state machine so clients only offer legal actions. */
export const SWAP_TRANSITIONS: Record<SwapStatus, readonly SwapStatus[]> = {
  PENDING: ['AGREED', 'CANCELLED'],
  AGREED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['CONFIRMING', 'DISPUTED'],
  CONFIRMING: ['COMPLETED', 'DISPUTED'],
  DISPUTED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const OFFER_STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'EXPIRED'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
export const OFFER_VISIBILITIES = ['PUBLIC', 'VERIFIED_ONLY', 'PREMIUM_ONLY', 'PRIVATE'] as const;
export type OfferVisibility = (typeof OFFER_VISIBILITIES)[number];

export const MEETUP_STATUSES = ['PROPOSED', 'COUNTER_PROPOSED', 'ACCEPTED', 'RESCHEDULED', 'SUPERSEDED', 'CANCELLED', 'COMPLETED'] as const;
export type MeetupStatus = (typeof MEETUP_STATUSES)[number];

export const PLAN_TIERS = ['FREE', 'PREMIUM', 'BUSINESS'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];
export const PRODUCT_KINDS = ['PREMIUM_PLAN', 'BUSINESS_PLAN', 'API_PLAN', 'BOOST', 'FEATURED', 'VERIFICATION', 'ADVERTISING'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const BILLING_INTERVALS = ['ONE_TIME', 'MONTH', 'YEAR'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export const FEATURED_PLACEMENTS = ['HOMEPAGE', 'MARKETPLACE_TOP', 'CURRENCY_PAIR'] as const;
export type FeaturedPlacement = (typeof FEATURED_PLACEMENTS)[number];
export const PAYMENT_STATUSES = ['REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const SUBSCRIPTION_STATUSES = ['INCOMPLETE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'UNPAID', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const VERIFICATION_CASE_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'EXPIRED'] as const;
export type VerificationCaseStatus = (typeof VERIFICATION_CASE_STATUSES)[number];
export const VERIFICATION_STATUSES = ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const DISPUTE_STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED'] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
export const DISPUTE_REASONS = ['NO_SHOW', 'WRONG_AMOUNT', 'FAKE_CURRENCY', 'UNSAFE_BEHAVIOR', 'HARASSMENT', 'FRAUD', 'COUNTERFEIT_MONEY', 'THREATENING_BEHAVIOR', 'OTHER'] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];
export const DISPUTE_OUTCOMES = ['SWAP_COMPLETED', 'SWAP_CANCELLED', 'WARNING', 'ACCOUNT_RESTRICTION', 'ESCALATED', 'NO_ACTION'] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

export const NOTIFICATION_TYPES = ['MATCH_FOUND', 'SWAP_REQUEST', 'SWAP_ACCEPTED', 'SWAP_REJECTED', 'SWAP_STARTED', 'SWAP_CONFIRMED', 'SWAP_COMPLETED', 'SWAP_CANCELLED', 'MEETUP_PROPOSED', 'MEETUP_ACCEPTED', 'MESSAGE_RECEIVED', 'RATING_RECEIVED', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'VERIFICATION_UPDATE', 'OFFER_BOOSTED', 'OFFER_FEATURED', 'OFFER_EXPIRING', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PLAN_EXPIRING', 'PLAN_EXPIRED', 'RATE_ALERT', 'REFERRAL_UPDATE', 'ACCOUNT_WARNING', 'LOGIN_ALERT', 'SYSTEM_ALERT'] as const;
export type NotificationTypeName = (typeof NOTIFICATION_TYPES)[number];
export const NOTIFICATION_ROUTES = ['SWAP_DETAILS', 'MEETUP', 'CHAT', 'DISPUTE', 'OFFER', 'SERVICE_PAYMENT', 'RATE_ALERT', 'VERIFICATION', 'PLAN', 'REFERRALS', 'PROFILE', 'NOTIFICATIONS'] as const;
export type NotificationRoute = (typeof NOTIFICATION_ROUTES)[number];

export const SUPPORTED_LOCALES = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const API_SCOPES = ['rates:read', 'offers:read', 'market:read'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

// ───────────────────────── Shared validators ─────────────────────────

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code');
/** Positive decimal string, e.g. "1500" or "1500.50". */
export const decimalString = z.string().trim().regex(/^\d{1,18}(\.\d{1,10})?$/, 'Enter a valid positive number');
export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
export const latitude = z.number().min(-90).max(90);
export const longitude = z.number().min(-180).max(180);
export const passwordRule = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');
/** E.164 international phone number. */
export const phoneE164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +442071234567');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

// ───────────────────────── DTOs ─────────────────────────

export interface CurrencyDto {
  code: string;
  name: string;
  symbol: string;
  minorUnit: number;
  region: string;
  isPopular: boolean;
  sortOrder: number;
  isActive?: boolean;
}

export interface TrustSummaryDto {
  rating: number;
  totalSwaps: number;
  successfulSwaps: number;
  completionRate: number;
  trustScore: number;
  verified: boolean;
  businessVerified: boolean;
  premiumBadge: boolean;
}

export interface PublicUserDto extends TrustSummaryDto {
  id: string;
  name: string;
  image: string | null;
  city: string | null;
  country: string | null;
  memberSince: string;
}

export interface MeDto {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: 'USER' | 'STAFF' | 'ADMIN' | 'SUPER_ADMIN';
  phone: string | null;
  phoneVerified: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  verificationStatus: VerificationStatus;
  verificationTier: 'NONE' | 'BASIC' | 'ENHANCED';
  idVerified: boolean;
  businessVerified: boolean;
  planTier: PlanTier;
  planExpiresAt: string | null;
  isPremium: boolean;
  country: string | null;
  city: string | null;
  languagePreference: string;
  timezone: string;
  preferredCurrencies: string[];
  receiveEmails: boolean;
  receiveSMS: boolean;
  receivePush: boolean;
  rating: number;
  totalSwaps: number;
  successfulSwaps: number;
  trustScore: number;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  sessionId: string;
}
export interface AuthResult {
  user: MeDto;
  tokens: AuthTokens;
}
export interface TwoFactorChallenge {
  twoFactorRequired: true;
}

export interface PublicAreaDto {
  /** Coarse public trading area — never the exact position. */
  latitude: number;
  longitude: number;
  label: string | null;
  radiusKm: number;
  city: string;
  country: string;
}

export interface OfferDto {
  id: string;
  owner: PublicUserDto;
  haveCurrency: string;
  wantCurrency: string;
  /** Original size of the offer. */
  haveAmount: string;
  /** Amount still available to reserve. */
  availableAmount: string;
  /** What the available amount is worth in the wanted currency at the offer's rate. */
  availableWantAmount: string;
  reservedAmount: string;
  minSwapAmount: string;
  exchangeRate: string;
  area: PublicAreaDto;
  /** Bucketed distance from the searcher, when a position was supplied. */
  distanceKm?: number;
  availableFrom: string;
  availableUntil: string;
  timeSlots: string[];
  notes: string | null;
  status: OfferStatus;
  visibility: OfferVisibility;
  requiresVerifiedUsers: boolean;
  minTrustScore: number;
  isBoosted: boolean;
  isFeatured: boolean;
  /** Sponsored placements must be labelled in every UI. */
  sponsored?: boolean;
  viewCount: number;
  createdAt: string;
  expiresAt: string | null;
  /** Only present for the owner. */
  mine?: boolean;
  boostedUntil?: string | null;
  featuredUntil?: string | null;
}

export interface SwapParticipantDto extends PublicUserDto {}

export interface SwapDto {
  id: string;
  status: SwapStatus;
  offerId: string;
  initiator: SwapParticipantDto;
  receiver: SwapParticipantDto;
  /** The offer owner's currency ("have") and the currency they want. */
  haveCurrency: string;
  wantCurrency: string;
  requested: { haveAmount: string; wantAmount: string; exchangeRate: string };
  /** Immutable snapshot, present once the swap has been agreed. */
  agreed: { haveAmount: string; wantAmount: string; exchangeRate: string; agreedAt: string } | null;
  iAm: 'INITIATOR' | 'RECEIVER';
  myConfirmed: boolean;
  otherConfirmed: boolean;
  meetup: MeetupDto | null;
  expiresAt: string;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  allowedActions: SwapAction[];
  unreadMessages?: number;
}
export type SwapAction = 'ACCEPT' | 'REJECT' | 'CANCEL' | 'PROPOSE_MEETUP' | 'CONFIRM' | 'DISPUTE' | 'RATE' | 'EXTEND';

export interface SwapEventDto {
  id: string;
  eventType: string;
  actor: 'INITIATOR' | 'RECEIVER' | 'SYSTEM' | 'STAFF' | null;
  previousStatus: SwapStatus | null;
  newStatus: SwapStatus | null;
  createdAt: string;
}

export interface MeetupDto {
  id: string;
  swapId: string;
  status: MeetupStatus;
  proposedByMe: boolean;
  locationName: string;
  approximateAddress: string;
  /** Exact venue — only after the meetup is accepted, only to participants. */
  exactAddress: string | null;
  privateNotes: string | null;
  latitude: number | null;
  longitude: number | null;
  scheduledAt: string;
  myConfirmed: boolean;
  otherConfirmed: boolean;
  myCheckedInAt: string | null;
  otherCheckedInAt: string | null;
  myCheckedOutAt: string | null;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  swapId: string;
  senderId: string;
  content: string;
  messageType: 'TEXT' | 'IMAGE' | 'SYSTEM';
  attachments: string[];
  readAt: string | null;
  createdAt: string;
  isDeleted: boolean;
  isEdited: boolean;
}
export interface ConversationDto {
  swapId: string;
  swapStatus: SwapStatus;
  other: PublicUserDto;
  lastMessage: MessageDto | null;
  unreadCount: number;
}

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  message: string;
  route: NotificationRoute;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface ServiceProductDto {
  code: string;
  kind: ProductKind;
  name: string;
  description: string | null;
  amount: string;
  currency: string;
  interval: BillingInterval;
  durationHours: number | null;
  planTier: PlanTier | null;
  placement: FeaturedPlacement | null;
  trialDays: number;
  features: string[];
}
export interface PaymentDto {
  id: string;
  productCode: string;
  kind: ProductKind;
  amount: string;
  currency: string;
  status: PaymentStatus;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  paidAt: string | null;
  failureReason: string | null;
  /** Amount refunded to the payer (CashMouver service payments only). */
  refundedAmount: string;
}
export interface SubscriptionDto {
  id: string;
  productCode: string;
  tier: PlanTier;
  status: SubscriptionStatus;
  interval: BillingInterval;
  amount: string;
  currency: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
}
export interface CheckoutSessionDto {
  paymentId: string;
  url: string;
}
export interface EntitlementsDto {
  planTier: PlanTier;
  policyKey: string;
  limits: {
    maxSwap: string;
    daily: string;
    weekly: string;
    monthly: string;
    limitCurrency: string;
    maxActiveOffers: number;
    maxActiveSwaps: number;
    maxRateAlerts: number;
    apiCallsPerMonth: number;
    maxBoostPurchasesMonth: number;
    maxTeamMembers: number;
  };
  features: {
    advancedSearch: boolean;
    priorityMatching: boolean;
    advancedAnalytics: boolean;
    premiumBadge: boolean;
    prioritySupport: boolean;
    apiAccess: boolean;
  };
  usage: { activeOffers: number; activeSwaps: number; rateAlerts: number; boostsThisMonth: number };
}

export interface BoostDto {
  id: string;
  offerId: string;
  startsAt: string;
  endsAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  impressions: number;
  clicks: number;
  price: string;
  currency: string;
  productCode: string;
}
export interface FeaturedDto extends Omit<BoostDto, never> {
  placement: FeaturedPlacement;
}

export interface RateAlertDto {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  targetRate: string;
  direction: 'ABOVE' | 'BELOW';
  isActive: boolean;
  lastTriggeredAt: string | null;
  triggerCount: number;
  createdAt: string;
}

export interface VerificationCaseDto {
  id: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
  tier: 'BASIC' | 'ENHANCED';
  status: VerificationCaseStatus;
  documentType: string;
  documentCountry: string;
  submittedAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  expiresAt: string | null;
  businessName: string | null;
  /** ENHANCED cases are reviewed only after the fee is paid. */
  needsPayment: boolean;
  documents?: { id: string; kind: string; mimeType: string; sizeBytes: number; uploadedAt: string }[];
}

export interface DisputeDto {
  id: string;
  swapId: string;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  isEscalated: boolean;
  outcome: DisputeOutcome | null;
  resolutionNote: string | null;
  iAmReporter: boolean;
  evidence: DisputeEvidenceDto[];
  events: { id: string; type: string; note: string | null; createdAt: string }[];
  createdAt: string;
  resolvedAt: string | null;
}
export interface DisputeEvidenceDto {
  id: string;
  type: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByMe: boolean;
  createdAt: string;
}

export interface ReferralSummaryDto {
  code: string;
  link: string;
  clicks: number;
  signups: number;
  qualified: number;
  rewarded: number;
  pending: number;
  /** Marketing rewards paid by CashMouver — never exchange money. */
  earnings: { currency: string; amount: string }[];
}
export interface ReferralItemDto {
  id: string;
  referredName: string;
  status: string;
  qualifyingAction: string | null;
  createdAt: string;
  qualifiedAt: string | null;
  reward: { amount: string; currency: string } | null;
}

export interface ApiKeyDto {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  rateLimitPerMinute: number;
  monthlyQuota: number;
  requestCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyCreatedDto extends ApiKeyDto {
  /** Shown exactly once, when the key is created or rotated. */
  key: string;
}
export interface ApiKeyUsageDto {
  monthlyQuota: number;
  usedThisMonth: number;
  days: { day: string; count: number; errors: number }[];
}

/** An ad as served to viewers. */
export interface AdDto {
  id: string;
  /** Always true — clients must render a "Sponsored" label. */
  sponsored: true;
  type: 'SPONSORED_OFFER' | 'SPONSORED_BUSINESS' | 'FEATURED_PARTNER';
  placement: 'HOMEPAGE' | 'MARKETPLACE';
  title: string;
  body: string | null;
  imageUrl: string | null;
  targetUrl: string | null;
  offerId: string | null;
}

/** An ad campaign as seen by its advertiser. */
export interface OwnerAdDto {
  id: string;
  type: AdDto['type'];
  placement: AdDto['placement'];
  title: string;
  body: string | null;
  imageUrl: string | null;
  targetUrl: string | null;
  offerId: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  impressions: number;
  clicks: number;
  reviewNote: string | null;
  currencies: string[];
  countries: string[];
  cities: string[];
}

export interface MarketStatDto {
  baseCurrency: string;
  quoteCurrency: string;
  day: string;
  averageRate: string;
  minRate: string;
  maxRate: string;
  bestRate: string;
  offerCount: number;
  swapCount: number;
  /** Total offered volume of the base currency that day. */
  supply: string;
}

// ───────────────────────── Request schemas ─────────────────────────

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: passwordRule,
  phone: phoneE164.optional().or(z.literal('').transform(() => undefined)),
  referralCode: z.string().trim().max(32).optional(),
  deviceId: z.string().max(128).optional(),
  deviceName: z.string().max(128).optional(),
  language: z.enum(SUPPORTED_LOCALES).optional(),
  timezone: z.string().max(64).optional(),
});
export type RegisterRequest = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  twoFactorCode: z.string().regex(/^\d{6}$|^[A-Z0-9]{10}$/).optional(),
  deviceId: z.string().max(128).optional(),
  deviceName: z.string().max(128).optional(),
});
export type LoginRequest = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20) });
export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(10), password: passwordRule });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordRule });
export const reauthSchema = z.object({ password: z.string().min(1), twoFactorCode: z.string().optional() });

const offerBase = z.object({
  haveCurrency: currencyCode,
  wantCurrency: currencyCode,
  haveAmount: decimalString,
  /** Optional: if supplied it must agree with haveAmount × exchangeRate. */
  wantAmount: decimalString.optional(),
  /** Optional: defaults to the current reference rate. */
  exchangeRate: decimalString.optional(),
  minSwapAmount: decimalString.optional(),
  country: z.string().length(2).toUpperCase(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().max(100).optional(),
  latitude: latitude,
  longitude: longitude,
  radiusKm: z.number().int().min(1).max(100).default(5),
  meetingArea: z.string().trim().max(120).optional(),
  availableFrom: z.string().datetime(),
  availableUntil: z.string().datetime(),
  timeSlots: z.array(z.string().max(40)).max(14).default([]),
  notes: z.string().trim().max(500).optional(),
  visibility: z.enum(OFFER_VISIBILITIES).default('PUBLIC'),
  requiresVerifiedUsers: z.boolean().default(false),
  minTrustScore: z.number().int().min(0).max(100).default(0),
});
export const createOfferSchema = offerBase.refine((v) => v.haveCurrency !== v.wantCurrency, {
  message: 'Currencies must differ',
  path: ['wantCurrency'],
});
export type CreateOfferRequest = z.infer<typeof createOfferSchema>;
export const updateOfferSchema = offerBase
  .pick({
    exchangeRate: true,
    minSwapAmount: true,
    meetingArea: true,
    availableFrom: true,
    availableUntil: true,
    timeSlots: true,
    notes: true,
    visibility: true,
    requiresVerifiedUsers: true,
    minTrustScore: true,
    radiusKm: true,
  })
  .partial();
export type UpdateOfferRequest = z.infer<typeof updateOfferSchema>;

export const offerSearchQuery = paginationQuery.extend({
  haveCurrency: currencyCode.optional(),
  wantCurrency: currencyCode.optional(),
  country: z.string().length(2).toUpperCase().optional(),
  city: z.string().max(100).optional(),
  minAmount: decimalString.optional(),
  maxAmount: decimalString.optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(1).max(200).optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  minTrustScore: z.coerce.number().int().min(0).max(100).optional(),
  availableNow: z.coerce.boolean().optional(),
  sortBy: z.enum(['relevance', 'rate', 'distance', 'newest', 'amount']).default('relevance'),
});
export type OfferSearchQuery = z.infer<typeof offerSearchQuery>;

export const createSwapSchema = z.object({
  offerId: objectId,
  /** Amount of the offer's "have" currency the taker wants to reserve. */
  haveAmount: decimalString,
  message: z.string().trim().max(500).optional(),
});
export type CreateSwapRequest = z.infer<typeof createSwapSchema>;
export const cancelSwapSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const rejectSwapSchema = z.object({ reason: z.string().trim().max(300).optional() });
export const confirmSwapSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(500).optional(),
});
export const extendSwapSchema = z.object({ hours: z.number().int().min(1).max(48), reason: z.string().trim().max(300).optional() });

export const proposeMeetupSchema = z.object({
  locationName: z.string().trim().min(2).max(120),
  approximateAddress: z.string().trim().min(2).max(200),
  exactAddress: z.string().trim().max(300).optional(),
  privateNotes: z.string().trim().max(500).optional(),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  scheduledAt: z.string().datetime(),
});
export type ProposeMeetupRequest = z.infer<typeof proposeMeetupSchema>;

export const sendMessageSchema = z.object({ swapId: objectId, content: z.string().trim().min(1).max(2000) });
export const editMessageSchema = z.object({ content: z.string().trim().min(1).max(2000) });
export const reportSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const rateAlertSchema = z.object({
  baseCurrency: currencyCode,
  quoteCurrency: currencyCode,
  targetRate: decimalString,
  direction: z.enum(['ABOVE', 'BELOW']),
});
export type RateAlertRequest = z.infer<typeof rateAlertSchema>;

export const checkoutSubscriptionSchema = z.object({ productCode: z.string().min(2).max(64) });
export const checkoutPromotionSchema = z.object({ productCode: z.string().min(2).max(64), offerId: objectId });
export const checkoutAdSchema = z.object({ productCode: z.string().min(2).max(64), campaignId: objectId });

export const createDisputeSchema = z.object({
  swapId: objectId,
  reason: z.enum(DISPUTE_REASONS),
  description: z.string().trim().min(10).max(2000),
});
export const resolveDisputeSchema = z.object({
  outcome: z.enum(DISPUTE_OUTCOMES),
  note: z.string().trim().min(5).max(2000),
  /** Required when the swap is still DISPUTED and the outcome is not SWAP_COMPLETED / SWAP_CANCELLED. */
  swapOutcome: z.enum(['COMPLETED', 'CANCELLED']).optional(),
});

export const verificationSubmitSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'BUSINESS']).default('INDIVIDUAL'),
  tier: z.enum(['BASIC', 'ENHANCED']).default('BASIC'),
  documentType: z.enum(['PASSPORT', 'NATIONAL_ID', 'DRIVING_LICENCE', 'RESIDENCE_PERMIT']),
  documentCountry: z.string().length(2).toUpperCase(),
  businessName: z.string().trim().max(200).optional(),
  registrationNumber: z.string().trim().max(100).optional(),
});

export const phoneOtpRequestSchema = z.object({ phone: phoneE164 });
export const phoneOtpVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  scopes: z.array(z.enum(API_SCOPES)).min(1).default(['rates:read', 'offers:read']),
});

export const adCampaignSchema = z.object({
  type: z.enum(['SPONSORED_OFFER', 'SPONSORED_BUSINESS', 'FEATURED_PARTNER']),
  placement: z.enum(['HOMEPAGE', 'MARKETPLACE']),
  title: z.string().trim().min(3).max(80),
  body: z.string().trim().max(200).optional(),
  imageUrl: z.string().url().optional(),
  targetUrl: z.string().url().optional(),
  offerId: objectId.optional(),
  currencies: z.array(currencyCode).max(20).default([]),
  countries: z.array(z.string().length(2).toUpperCase()).max(30).default([]),
  cities: z.array(z.string().max(100)).max(30).default([]),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  bio: z.string().trim().max(500).optional(),
  country: z.string().length(2).toUpperCase().optional(),
  city: z.string().trim().max(100).optional(),
  languagePreference: z.enum(SUPPORTED_LOCALES).optional(),
  timezone: z.string().max(64).optional(),
  preferredCurrencies: z.array(currencyCode).max(20).optional(),
});

// ───────────────────────── Notification routing ─────────────────────────

/** Same mapping on web and mobile: where a notification should take the user. */
export function notificationTarget(route: NotificationRoute, entityId: string | null): { screen: string; params: Record<string, string> } {
  const id = entityId ?? '';
  switch (route) {
    case 'SWAP_DETAILS': return { screen: 'SwapDetails', params: { swapId: id } };
    case 'MEETUP': return { screen: 'SwapDetails', params: { swapId: id, tab: 'meetup' } };
    case 'CHAT': return { screen: 'Chat', params: { swapId: id } };
    case 'DISPUTE': return { screen: 'Dispute', params: { disputeId: id } };
    case 'OFFER': return { screen: 'OfferDetails', params: { offerId: id } };
    case 'SERVICE_PAYMENT': return { screen: 'ServicePayment', params: { paymentId: id } };
    case 'RATE_ALERT': return { screen: 'RateAlerts', params: { alertId: id } };
    case 'VERIFICATION': return { screen: 'Verification', params: {} };
    case 'PLAN': return { screen: 'Premium', params: {} };
    case 'REFERRALS': return { screen: 'Referrals', params: {} };
    case 'PROFILE': return { screen: 'Profile', params: {} };
    default: return { screen: 'Notifications', params: {} };
  }
}

export const WEB_PATHS: Record<NotificationRoute, (id: string | null) => string> = {
  SWAP_DETAILS: (id) => `/dashboard/swaps/${id}`,
  MEETUP: (id) => `/dashboard/swaps/${id}?tab=meetup`,
  CHAT: (id) => `/dashboard/messages/${id}`,
  DISPUTE: (id) => `/dashboard/disputes/${id}`,
  OFFER: (id) => `/dashboard/offers/${id}`,
  SERVICE_PAYMENT: (id) => `/dashboard/billing?payment=${id}`,
  RATE_ALERT: () => `/dashboard/rate-alerts`,
  VERIFICATION: () => `/dashboard/verification`,
  PLAN: () => `/dashboard/premium`,
  REFERRALS: () => `/dashboard/referrals`,
  PROFILE: () => `/dashboard/profile`,
  NOTIFICATIONS: () => `/dashboard/notifications`,
};

export const PRODUCT_NAME = 'CashMouver';
export const PRODUCT_DOMAIN = 'cashmouver.com';
