//src/utils/logger.util.ts
import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { config } from '@/config/env';

const levels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };
const colors = { error: 'red', warn: 'yellow', info: 'green', http: 'magenta', debug: 'blue' };

winston.addColors(colors);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info) => `${info.timestamp} ${info.level}: ${info.message}`)
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Ensure logs directory exists
const logsDir = path.resolve(process.cwd(), config.logging.filePath);
try {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (e) {
  console.warn('[LOGGER] Could not create logs directory:', e);
}

// Always include console transport
const transports: winston.transport[] = [new winston.transports.Console({ format: consoleFormat })];

if (config.isProduction) {
  // Production: use DailyRotateFile (lazy-required to avoid Windows dev hang)
  try {
    const DailyRotateFile = require('winston-daily-rotate-file');
    transports.push(
      new DailyRotateFile({
        filename: path.join(logsDir, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        format: fileFormat,
        maxSize: '20m',
        maxFiles: '14d',
        zippedArchive: true,
      }),
      new DailyRotateFile({
        filename: path.join(logsDir, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        format: fileFormat,
        maxSize: '20m',
        maxFiles: '14d',
        zippedArchive: true,
      }),
      new DailyRotateFile({
        filename: path.join(logsDir, 'access-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: 'http',
        format: fileFormat,
        maxSize: '20m',
        maxFiles: '7d',
        zippedArchive: true,
      })
    );
  } catch (e) {
    console.warn('[LOGGER] Could not add rotating file transports:', e);
  }
} else {
  // Development: simple File transport — no rotation watchers, no Windows hang
  try {
    transports.push(
      new winston.transports.File({
        filename: path.join(logsDir, 'error.log'),
        level: 'error',
        format: fileFormat,
      }),
      new winston.transports.File({
        filename: path.join(logsDir, 'combined.log'),
        format: fileFormat,
      })
    );
  } catch (e) {
    console.warn('[LOGGER] Could not add file transports:', e);
  }
}

// No exceptionHandlers/rejectionHandlers — server.ts handles these via process.on()
const logger = winston.createLogger({
  level: config.logging.level,
  levels,
  transports,
  exitOnError: false,
});

export const morganStream = { write: (message: string) => logger.http(message.trim()) };
export const logError = (error: Error, context?: Record<string, any>) =>
  logger.error({ message: error.message, stack: error.stack, ...context });
export const logInfo = (message: string, context?: Record<string, any>) =>
  logger.info({ message, ...context });
export const logWarn = (message: string, context?: Record<string, any>) =>
  logger.warn({ message, ...context });
export const logDebug = (message: string, context?: Record<string, any>) =>
  logger.debug({ message, ...context });
export const logHttp = (message: string, context?: Record<string, any>) =>
  logger.http({ message, ...context });

export default logger;
