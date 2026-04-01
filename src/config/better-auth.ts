// src/config/better-auth.ts
// Better-auth is configured for the NextJS web frontend.
// The backend uses custom JWT auth (see auth.service.ts).
// This file exists as a placeholder / shared config reference.

import { config } from './env';

export const authConfig = {
  secret:            config.jwt.secret,
  baseURL:           config.appUrl,
  database: {
    provider: 'mongodb' as const,
    url:      process.env.DATABASE_URL ?? '',
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  session: {
    expiresIn:          60 * 60 * 24 * 7,   // 7 days
    updateAge:          60 * 60 * 24,        // refresh daily
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
} as const;
