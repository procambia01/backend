import { z } from 'zod';

export const createRatingValidator = z.object({
  body: z.object({
    swapId: z.string().min(1, 'Swap ID is required'),
    receiverId: z.string().min(1, 'Receiver ID is required'),
    stars: z.number().min(1).max(5),
    comment: z.string().max(500).optional(),
    punctuality: z.number().min(1).max(5).optional(),
    communication: z.number().min(1).max(5).optional(),
    professionalism: z.number().min(1).max(5).optional(),
    safety: z.number().min(1).max(5).optional(),
  }),
});

export const reportRatingValidator = z.object({
  body: z.object({
    reason: z.string().max(500),
  }),
});
