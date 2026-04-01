// src/types/index.d.ts
export {};

// src/types/auth.types.ts
export interface JwtPayloadCustom {
  userId: string;
  email:  string;
  role:   string;
  type:   'access' | 'refresh';
}

// src/types/user.types.ts
export type UserRole = 'USER' | 'STAFF' | 'ADMIN' | 'SUPER_ADMIN';
export type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
export type PremiumTier = 'BASIC' | 'PREMIUM' | 'BUSINESS';

export interface UpdateProfilePayload {
  name?:    string;
  phone?:   string;
  bio?:     string;
  country?: string;
  city?:    string;
  state?:   string;
  preferredCurrencies?:    string[];
  preferredMeetingPlaces?: string[];
  maxSwapAmount?:          number;
  languagePreference?:     string;
}

// src/types/offer.types.ts
export type OfferStatus = 'ACTIVE' | 'MATCHED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'PAUSED';

export interface CreateOfferPayload {
  haveCurrency:   string;
  wantCurrency:   string;
  haveAmount:     number;
  wantAmount:     number;
  country:        string;
  city:           string;
  state?:         string;
  latitude:       number;
  longitude:      number;
  meetingArea?:   string;
  radius?:        number;
  availableFrom:  string;
  availableUntil: string;
  timeSlots?:     string[];
  isFlexible?:    boolean;
  visibility?:    string;
  notes?:         string;
  requiresVerifiedUsers?: boolean;
  minTrustScore?: number;
}

// src/types/swap.types.ts
export type SwapStatus =
  | 'PENDING' | 'AGREED' | 'IN_PROGRESS' | 'CONFIRMING'
  | 'COMPLETED' | 'CANCELLED' | 'DISPUTED' | 'FAILED' | 'EXPIRED';

// src/types/common.types.ts
export interface PaginationOptions {
  page:    number;
  perPage: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page:        number;
    perPage:     number;
    total:       number;
    totalPages:  number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  message: string;
  data:    T;
}
