import { z } from 'zod';

export const sendMessageValidator = z.object({
  body: z.object({
    swapId: z.string().min(1, 'Swap ID is required'),
    content: z.string().min(1).max(2000),
    messageType: z.enum(['TEXT', 'IMAGE', 'LOCATION', 'SYSTEM']).default('TEXT'),
  }),
});

export const editMessageValidator = z.object({
  body: z.object({
    content: z.string().min(1).max(2000),
  }),
});

