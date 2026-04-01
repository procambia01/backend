import { z } from 'zod';

export const createOfferValidator = z.object({
  body: z.object({
    haveCurrency: z.string().length(3, 'Currency code must be 3 characters'),
    wantCurrency: z.string().length(3, 'Currency code must be 3 characters'),
    haveAmount: z.number().positive('Amount must be positive'),
    wantAmount: z.number().positive('Amount must be positive').optional(),
    exchangeRate: z.number().positive().optional(),
    country: z.string().min(2),
    city: z.string().min(2),
    state: z.string().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    meetingArea: z.string().max(200).optional(),
    radius: z.number().positive().max(100).default(5),
    availableFrom: z.string().datetime(),
    availableUntil: z.string().datetime(),
    timeSlots: z.array(z.string()).optional(),
    isFlexible: z.boolean().default(true),
    notes: z.string().max(500).optional(),
    preferredMeetingPlaces: z.array(z.string()).optional(),
    requiresVerifiedUsers: z.boolean().default(false),
    minTrustScore: z.number().min(0).max(100).default(0),
    visibility: z.enum(['PUBLIC', 'VERIFIED_ONLY', 'PREMIUM_ONLY', 'PRIVATE']).default('PUBLIC'),
  }).refine((data) => data.haveCurrency !== data.wantCurrency, {
    message: 'Have currency and want currency must be different',
    path: ['wantCurrency'],
  }),
});

export const updateOfferValidator = z.object({
  body: z.object({
    haveAmount: z.number().positive().optional(),
    wantAmount: z.number().positive().optional(),
    exchangeRate: z.number().positive().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    meetingArea: z.string().max(200).optional(),
    radius: z.number().positive().max(100).optional(),
    availableFrom: z.string().datetime().optional(),
    availableUntil: z.string().datetime().optional(),
    timeSlots: z.array(z.string()).optional(),
    isFlexible: z.boolean().optional(),
    notes: z.string().max(500).optional(),
    preferredMeetingPlaces: z.array(z.string()).optional(),
    requiresVerifiedUsers: z.boolean().optional(),
    minTrustScore: z.number().min(0).max(100).optional(),
    visibility: z.enum(['PUBLIC', 'VERIFIED_ONLY', 'PREMIUM_ONLY', 'PRIVATE']).optional(),
  }),
});

export const searchOffersValidator = z.object({
  body: z.object({
    haveCurrency: z.string().length(3).optional(),
    wantCurrency: z.string().length(3).optional(),
    minAmount: z.number().positive().optional(),
    maxAmount: z.number().positive().optional(),
    country: z.string().optional(),
    city: z.string().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    radius: z.number().positive().max(100).optional(),
    verifiedOnly: z.boolean().optional(),
    minTrustScore: z.number().min(0).max(100).optional(),
    availableNow: z.boolean().optional(),
    sortBy: z.enum(['distance', 'amount', 'rating', 'date']).default('distance'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),
    page: z.number().positive().default(1),
    limit: z.number().positive().max(100).default(10),
  }),
});