import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));
const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int());

export const envSchema = z
  .object({
    // Application
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: int(8080),
    APP_NAME: z.string().default('CashMouver'),
    APP_URL: z.string().url(),
    API_URL: z.string().url(),
    TRUST_PROXY: int(1),

    // Database
    DATABASE_URL: z.string().min(1),

    // Auth
    JWT_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
    COOKIE_SECRET: z.string().min(32),
    /** Key used to HMAC low-entropy values (OTPs, IPs, device ids) before storage. */
    HASH_PEPPER: z.string().min(32),
    /** Key used to encrypt TOTP seeds at rest. */
    DATA_ENCRYPTION_KEY: z.string().min(32),
    BCRYPT_ROUNDS: int(12),

    // Redis (optional — rate limiting and caches degrade gracefully)
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: int(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_DB: int(0),
    REDIS_URL: z.string().optional(),

    // CORS
    CORS_ORIGIN: z.string(),
    ALLOWED_ORIGINS: z.string(),

    // Cloudinary (public avatars + PRIVATE `authenticated` assets for KYC/evidence)
    CLOUDINARY_CLOUD_NAME: z.string().min(1),
    CLOUDINARY_API_KEY: z.string().min(1),
    CLOUDINARY_API_SECRET: z.string().min(1),
    CLOUDINARY_FOLDER: z.string().default('cashmouver'),

    // Email
    EMAIL_DRIVER: z.enum(['smtp', 'resend', 'console']).default('smtp'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: int(587),
    SMTP_SECURE: bool(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().email(),
    EMAIL_FROM_NAME: z.string().default('CashMouver'),
    RESEND_API_KEY: z.string().optional(),

    // SMS (Twilio). `console` is refused in production.
    SMS_DRIVER: z.enum(['twilio', 'console']).default('twilio'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_PHONE_NUMBER: z.string().optional(),

    // Push
    EXPO_ACCESS_TOKEN: z.string().optional(),

    // Stripe — the only payment processor, used for CashMouver service fees only.
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // Reference exchange rates & maps
    EXCHANGE_RATE_API_KEY: z.string().optional(),
    EXCHANGE_RATE_API_URL: z.string().url().optional(),
    GOOGLE_MAPS_API_KEY: z.string().optional(),

    // Rate limiting
    RATE_LIMIT_WINDOW_MS: int(900000),
    RATE_LIMIT_MAX_REQUESTS: int(300),

    // Uploads
    MAX_FILE_SIZE: int(8 * 1024 * 1024),

    // KYC / retention
    KYC_DOCUMENT_RETENTION_DAYS: int(90),
    VERIFICATION_VALID_MONTHS: int(24),
    SIGNED_URL_TTL_SECONDS: int(120),

    // Admin bootstrap
    SUPER_ADMIN_EMAIL: z.string().email().optional(),
    SUPER_ADMIN_PASSWORD: z.string().min(12).optional(),

    // Logging
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
    LOG_FILE_PATH: z.string().default('./logs'),
    LOG_TO_FILE: bool(false),

    // Background work
    ENABLE_CRON_JOBS: bool(true),
    EXCHANGE_RATE_UPDATE_CRON: z.string().default('*/30 * * * *'),
    CLEANUP_CRON: z.string().default('15 3 * * *'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
      }
      if (env.SMS_DRIVER === 'console') {
        ctx.addIssue({ code: 'custom', path: ['SMS_DRIVER'], message: 'The console SMS driver is not allowed in production' });
      }
      if (env.EMAIL_DRIVER === 'console') {
        ctx.addIssue({ code: 'custom', path: ['EMAIL_DRIVER'], message: 'The console email driver is not allowed in production' });
      }
    }
  });

export type EnvInput = z.input<typeof envSchema>;

export function buildConfig(source: NodeJS.ProcessEnv) {
  const env = envSchema.parse(source);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    appName: env.APP_NAME,
    appUrl: env.APP_URL,
    apiUrl: env.API_URL,
    trustProxy: env.TRUST_PROXY,
    isDevelopment: env.NODE_ENV === 'development',
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',

    database: { url: env.DATABASE_URL },

    jwt: {
      secret: env.JWT_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshSecret: env.JWT_REFRESH_SECRET,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    },

    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      url: env.REDIS_URL,
    },

    cors: {
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
      allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()),
    },

    cloudinary: {
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
      folder: env.CLOUDINARY_FOLDER,
    },

    email: {
      driver: env.EMAIL_DRIVER,
      smtp: {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
      },
      from: env.EMAIL_FROM,
      fromName: env.EMAIL_FROM_NAME,
      resendApiKey: env.RESEND_API_KEY,
    },

    sms: {
      driver: env.SMS_DRIVER,
      twilio: {
        accountSid: env.TWILIO_ACCOUNT_SID,
        authToken: env.TWILIO_AUTH_TOKEN,
        phoneNumber: env.TWILIO_PHONE_NUMBER,
      },
    },

    push: { expoAccessToken: env.EXPO_ACCESS_TOKEN },

    payment: {
      stripe: {
        secretKey: env.STRIPE_SECRET_KEY,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
      },
    },

    exchangeRate: { apiKey: env.EXCHANGE_RATE_API_KEY, apiUrl: env.EXCHANGE_RATE_API_URL },
    googleMaps: { apiKey: env.GOOGLE_MAPS_API_KEY },

    rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, maxRequests: env.RATE_LIMIT_MAX_REQUESTS },

    upload: { maxFileSize: env.MAX_FILE_SIZE },

    kyc: {
      documentRetentionDays: env.KYC_DOCUMENT_RETENTION_DAYS,
      validMonths: env.VERIFICATION_VALID_MONTHS,
      signedUrlTtlSeconds: env.SIGNED_URL_TTL_SECONDS,
    },

    security: {
      bcryptRounds: env.BCRYPT_ROUNDS,
      cookieSecret: env.COOKIE_SECRET,
      hashPepper: env.HASH_PEPPER,
      dataEncryptionKey: env.DATA_ENCRYPTION_KEY,
    },

    admin: { email: env.SUPER_ADMIN_EMAIL, password: env.SUPER_ADMIN_PASSWORD },

    logging: { level: env.LOG_LEVEL, filePath: env.LOG_FILE_PATH, toFile: env.LOG_TO_FILE },

    cron: {
      enabled: env.ENABLE_CRON_JOBS,
      exchangeRateUpdate: env.EXCHANGE_RATE_UPDATE_CRON,
      cleanup: env.CLEANUP_CRON,
    },
  };
}

export type AppConfig = ReturnType<typeof buildConfig>;

function load(): AppConfig {
  try {
    return buildConfig(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // eslint-disable-next-line no-console
      console.error('Invalid environment variables:\n' + JSON.stringify(error.format(), null, 2));
      process.exit(1);
    }
    throw error;
  }
}

export const config: AppConfig = load();
export default config;
