import { z } from 'zod';
export const idParamValidator = z.object({
  params: z.object({
    id: z.string().min(1, 'ID is required'),
  }),
});

export const paginationValidator = z.object({
  query: z.object({
    page: z.string().transform(Number).pipe(z.number().positive()).default('1'),
    limit: z.string().transform(Number).pipe(z.number().positive().max(100)).default('10'),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
  }),
});