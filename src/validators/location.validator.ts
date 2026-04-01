import { z } from 'zod';

export const saveLocationValidator = z.object({
  body: z.object({
    name: z.string().min(2).max(100),
    address: z.string().min(5).max(300),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    city: z.string().min(2),
    state: z.string().optional(),
    country: z.string().min(2),
    placeId: z.string().optional(),
    isPrimary: z.boolean().default(false),
    isPublic: z.boolean().default(true),
    category: z.string().optional(),
  }),
});

