import { z } from 'zod';

export const updateProfileValidator = z.object({
  body: z.object({
    name: z.string().min(2).max(100).optional(),
    bio: z.string().max(500).optional(),
    phone: z.string().optional(),
    country: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  }),
});

export const updatePreferencesValidator = z.object({
  body: z.object({
    preferredCurrencies: z.array(z.string()).optional(),
    preferredMeetingPlaces: z.array(z.string()).optional(),
    maxSwapAmount: z.number().positive().optional(),
    notificationPreferences: z.object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
      push: z.boolean().optional(),
    }).optional(),
    languagePreference: z.string().optional(),
    darkMode: z.boolean().optional(),
  }),
});

export const verifyPhoneValidator = z.object({
  body: z.object({
    phone: z.string().min(10, 'Invalid phone number'),
    code: z.string().length(6, 'Code must be 6 digits').optional(),
  }),
});

export const submitVerificationValidator = z.object({
  body: z.object({
    documentType: z.enum(['PASSPORT', 'DRIVERS_LICENSE', 'NATIONAL_ID', 'OTHER']),
    documentNumber: z.string().optional(),
    country: z.string(),
  }),
});

export const blockUserValidator = z.object({
  body: z.object({
    blockedId: z.string(),
    reason: z.string().optional(),
  }),
});

export const addFavoriteValidator = z.object({
  body: z.object({
    favoriteId: z.string(),
    notes: z.string().max(500).optional(),
  }),
});

export const searchUsersValidator = z.object({
  query: z.object({
    q: z.string().optional(),
    country: z.string().optional(),
    city: z.string().optional(),
    verified: z.boolean().optional(),
    minRating: z.number().min(0).max(5).optional(),
    page: z.number().positive().optional(),
    limit: z.number().positive().max(100).optional(),
  }),
});