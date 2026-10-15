import type { PlanTier, UserRole } from '@prisma/client';

export interface AuthUser {
  userId: string;
  email: string;
  role: UserRole;
  sessionId: string;
  familyId: string;
  /** Effective plan right now (expiry-aware), not the stored column. */
  planTier: PlanTier;
  emailVerified: boolean;
  phoneVerified: boolean;
  idVerified: boolean;
  reauthUntil: Date | null;
  language: string;
}

export interface ApiKeyContext {
  id: string;
  ownerId: string;
  scopes: string[];
  rateLimitPerMinute: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      apiKey?: ApiKeyContext;
      /** Exact raw bytes, set only on the Stripe webhook route. */
      rawBody?: Buffer;
    }
  }
}
