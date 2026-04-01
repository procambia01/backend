//src/validators/swap.validator.ts
import { z } from 'zod';

export const initiateSwapValidator = z.object({
  body: z.object({
    offerId: z.string().min(1, 'Offer ID is required'),
    message: z.string().max(500).optional(),
  }),
});

export const updateMeetupValidator = z.object({
  body: z.object({
    meetupLocation: z.string().max(200),
    meetupAddress: z.string().max(300).optional(),
    meetupTime: z.string().datetime(),
    meetupLatitude: z.number().min(-90).max(90).optional(),
    meetupLongitude: z.number().min(-180).max(180).optional(),
    meetupNotes: z.string().max(500).optional(),
  }),
});

export const confirmSwapValidator = z.object({
  body: z.object({
    rating: z.number().min(1).max(5).optional(),
    comment: z.string().max(500).optional(),
  }),
});

export const cancelSwapValidator = z.object({
  body: z.object({
    reason: z.string().max(500),
  }),
});

