import { z } from 'zod';

export const createDisputeValidator = z.object({
  body: z.object({
    swapId: z.string().min(1, 'Swap ID is required'),
    reason: z.enum([
      'NO_SHOW',
      'WRONG_AMOUNT',
      'FAKE_CURRENCY',
      'UNSAFE_BEHAVIOR',
      'HARASSMENT',
      'FRAUD',
      'COUNTERFEIT_MONEY',
      'THREATENING_BEHAVIOR',
      'OTHER'
    ]),
    description: z.string().min(10).max(1000),
    evidence: z.array(z.string()).optional(),
  }),
});

export const resolveDisputeValidator = z.object({
  body: z.object({
    resolution: z.string().min(10).max(1000),
    resolutionNote: z.string().max(500).optional(),
  }),
});

