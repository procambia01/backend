import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('5000'),
  APP_NAME: z.string().default('Currency Exchange Platform'),
  APP_URL: z.string().url(),
  API_URL: z.string().url(),

  // Database
  DATABASE_URL: z.string().min(1),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_TRUST_HOST: z.string().transform(val => val === 'true').default('false'),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.string().transform(Number).default('0'),
  REDIS_URL: z.string().optional(),

  // CORS
  CORS_ORIGIN: z.string(),
  ALLOWED_ORIGINS: z.string(),

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),
  CLOUDINARY_FOLDER: z.string().default('currency-exchange'),

  // Email
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().transform(Number).optional(),
  SMTP_SECURE: z.string().transform(val => val === 'true').optional(),
  SMTP_USER: z.string().email().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().email(),
  EMAIL_FROM_NAME: z.string(),
  RESEND_API_KEY: z.string().optional(),

  // SMS (Twilio)
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  // Push Notifications
  EXPO_ACCESS_TOKEN: z.string().optional(),

  // Payment Gateways
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional(),
  FLUTTERWAVE_SECRET_KEY: z.string().optional(),
  FLUTTERWAVE_ENCRYPTION_KEY: z.string().optional(),

  // Exchange Rate API
  EXCHANGE_RATE_API_KEY: z.string().optional(),
  EXCHANGE_RATE_API_URL: z.string().url().optional(),

  // Google Maps
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().transform(Number).default('100'),

  // File Upload
  MAX_FILE_SIZE: z.string().transform(Number).default('5242880'),
  ALLOWED_FILE_TYPES: z.string().default('image/jpeg,image/png,image/jpg,application/pdf'),

  // Security
  BCRYPT_ROUNDS: z.string().transform(Number).default('10'),
  SESSION_SECRET: z.string().min(32),
  COOKIE_SECRET: z.string().min(32),

  // Verification & Trust
  VERIFICATION_FEE_AMOUNT: z.string().transform(Number).default('5.00'),
  MIN_TRUST_SCORE: z.string().transform(Number).default('0'),
  MAX_SWAP_AMOUNT_UNVERIFIED: z.string().transform(Number).default('100'),
  MAX_SWAP_AMOUNT_VERIFIED: z.string().transform(Number).default('10000'),

  // Premium Pricing
  PREMIUM_MONTHLY_PRICE: z.string().transform(Number).default('9.99'),
  PREMIUM_YEARLY_PRICE: z.string().transform(Number).default('99.99'),
  BUSINESS_MONTHLY_PRICE: z.string().transform(Number).default('29.99'),
  BUSINESS_YEARLY_PRICE: z.string().transform(Number).default('299.99'),

  // Admin
  SUPER_ADMIN_EMAIL: z.string().email(),
  SUPER_ADMIN_PASSWORD: z.string().min(8),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  LOG_FILE_PATH: z.string().default('./logs'),

  // Socket.IO
  SOCKET_PORT: z.string().transform(Number).default('5001'),

  // Cron Jobs
  ENABLE_CRON_JOBS: z.string().transform(val => val === 'true').default('true'),
  EXCHANGE_RATE_UPDATE_CRON: z.string().default('0 */6 * * *'),
  CLEANUP_CRON: z.string().default('0 2 * * *'),

  // Development
  DEBUG: z.string().transform(val => val === 'true').default('false'),
  MOCK_PAYMENTS: z.string().transform(val => val === 'true').default('false'),
  MOCK_SMS: z.string().transform(val => val === 'true').default('false'),
  MOCK_EMAIL: z.string().transform(val => val === 'true').default('false'),
});

type EnvConfig = z.infer<typeof envSchema>;

let env: EnvConfig;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Invalid environment variables:');
    console.error(JSON.stringify(error.format(), null, 2));
    process.exit(1);
  }
  throw error;
}

export const config = {
  // Application
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  appName: env.APP_NAME,
  appUrl: env.APP_URL,
  apiUrl: env.API_URL,
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  // Database
  database: {
    url: env.DATABASE_URL,
  },

  // Better Auth
  betterAuth: {
    secret: env.BETTER_AUTH_SECRET,
    url: env.BETTER_AUTH_URL,
    trustHost: env.BETTER_AUTH_TRUST_HOST,
  },

  // JWT
  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    refreshSecret: env.JWT_REFRESH_SECRET,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },

  // Redis
  redis: {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    db: env.REDIS_DB,
    url: env.REDIS_URL,
  },

  // CORS
  cors: {
    origin: env.CORS_ORIGIN.split(',').map(origin => origin.trim()),
    allowedOrigins: env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()),
  },

  // Cloudinary
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
    folder: env.CLOUDINARY_FOLDER,
  },

  // Email
  email: {
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

  // SMS
  sms: {
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      phoneNumber: env.TWILIO_PHONE_NUMBER,
    },
  },

  // Push Notifications
  push: {
    expoAccessToken: env.EXPO_ACCESS_TOKEN,
  },

  // Payment Gateways
  payment: {
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    },
    paystack: {
      secretKey: env.PAYSTACK_SECRET_KEY,
      publicKey: env.PAYSTACK_PUBLIC_KEY,
    },
    flutterwave: {
      publicKey: env.FLUTTERWAVE_PUBLIC_KEY,
      secretKey: env.FLUTTERWAVE_SECRET_KEY,
      encryptionKey: env.FLUTTERWAVE_ENCRYPTION_KEY,
    },
  },

  // Exchange Rate
  exchangeRate: {
    apiKey: env.EXCHANGE_RATE_API_KEY,
    apiUrl: env.EXCHANGE_RATE_API_URL,
  },

  // Google Maps
  googleMaps: {
    apiKey: env.GOOGLE_MAPS_API_KEY,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
  },

  // File Upload
  upload: {
    maxFileSize: env.MAX_FILE_SIZE,
    allowedFileTypes: env.ALLOWED_FILE_TYPES.split(',').map(type => type.trim()),
  },

  // Security
  security: {
    bcryptRounds: env.BCRYPT_ROUNDS,
    sessionSecret: env.SESSION_SECRET,
    cookieSecret: env.COOKIE_SECRET,
  },

  // Verification
  verification: {
    feeAmount: env.VERIFICATION_FEE_AMOUNT,
    minTrustScore: env.MIN_TRUST_SCORE,
    maxSwapAmountUnverified: env.MAX_SWAP_AMOUNT_UNVERIFIED,
    maxSwapAmountVerified: env.MAX_SWAP_AMOUNT_VERIFIED,
  },

  // Premium
  premium: {
    monthlyPrice: env.PREMIUM_MONTHLY_PRICE,
    yearlyPrice: env.PREMIUM_YEARLY_PRICE,
    businessMonthlyPrice: env.BUSINESS_MONTHLY_PRICE,
    businessYearlyPrice: env.BUSINESS_YEARLY_PRICE,
  },

  // Admin
  admin: {
    email: env.SUPER_ADMIN_EMAIL,
    password: env.SUPER_ADMIN_PASSWORD,
  },

  // Logging
  logging: {
    level: env.LOG_LEVEL,
    filePath: env.LOG_FILE_PATH,
  },

  // Socket
  socket: {
    port: env.SOCKET_PORT,
  },

  // Cron
  cron: {
    enabled: env.ENABLE_CRON_JOBS,
    exchangeRateUpdate: env.EXCHANGE_RATE_UPDATE_CRON,
    cleanup: env.CLEANUP_CRON,
  },

  // Development
  debug: env.DEBUG,
  mock: {
    payments: env.MOCK_PAYMENTS,
    sms: env.MOCK_SMS,
    email: env.MOCK_EMAIL,
  },
};

export default config;