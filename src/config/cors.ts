import { CorsOptions } from 'cors';
import { config } from './env';
import logger from '@/utils/logger.util';

const allowedOrigins = config.cors.allowedOrigins;

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Allow-Origin',
    'X-Api-Key',
    'X-Device-Id',
    'X-Platform',
  ],
  exposedHeaders: [
    'X-Total-Count',
    'X-Page',
    'X-Per-Page',
    'X-Total-Pages',
  ],
  maxAge: 86400, // 24 hours
  optionsSuccessStatus: 200,
};

export default corsOptions;