
import { z } from 'zod';

export const updateUserRoleValidator = z.object({
  body: z.object({
    role: z.enum(['USER', 'STAFF', 'ADMIN', 'SUPER_ADMIN']),
  }),
});

export const banUserValidator = z.object({
  body: z.object({
    reason: z.string().min(10).max(500),
    duration: z.number().positive().optional(), // Duration in days
    permanent: z.boolean().default(false),
  }),
});

export const updateSystemConfigValidator = z.object({
  body: z.object({
    key: z.string().min(1),
    value: z.string(),
    description: z.string().optional(),
  }),
});

