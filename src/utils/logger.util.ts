import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { config } from '@/config/env';
import { getContext } from '@/lib/request-context';
import { redact } from '@/lib/redact';

const levels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };

/** Adds requestId / userId from the async request context and redacts secrets. */
const enrich = winston.format((info) => {
  const ctx = getContext();
  if (ctx) {
    info.requestId = ctx.requestId;
    if (ctx.userId) info.userId = ctx.userId;
  }
  info.service = 'cashmouver-api';
  const { level, message, timestamp, requestId, userId, service, ...rest } = info as Record<string, unknown>;
  const cleaned = redact(rest) as Record<string, unknown>;
  return Object.assign({ level, message, timestamp, requestId, userId, service }, cleaned) as winston.Logform.TransformableInfo;
});

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: false }),
  enrich(),
  winston.format.json()
);

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  enrich(),
  winston.format.colorize({ all: true }),
  winston.format.printf((i) => {
    const { level, message, timestamp, requestId, userId, service, ...rest } = i as Record<string, unknown>;
    const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
    return `${timestamp} ${level} ${requestId ? `[${String(requestId).slice(0, 8)}] ` : ''}${message}${extra}`;
  })
);

const transports: winston.transport[] = [
  new winston.transports.Console({ format: config.isProduction || config.isTest ? jsonFormat : devFormat, silent: config.isTest }),
];

// File logging is opt-in (LOG_TO_FILE=true). Containers log to stdout.
if (config.logging.toFile) {
  try {
    const dir = path.resolve(process.cwd(), config.logging.filePath);
    fs.mkdirSync(dir, { recursive: true });
    transports.push(
      new winston.transports.File({ filename: path.join(dir, 'error.log'), level: 'error', format: jsonFormat }),
      new winston.transports.File({ filename: path.join(dir, 'combined.log'), format: jsonFormat })
    );
  } catch {
    /* logging must never take the process down */
  }
}

const logger = winston.createLogger({ level: config.logging.level, levels, transports, exitOnError: false });

export const logError = (error: Error, context?: Record<string, unknown>) =>
  logger.error(error.message, { stack: config.isProduction ? undefined : error.stack, ...context });
export const logInfo = (message: string, context?: Record<string, unknown>) => logger.info(message, context);
export const logWarn = (message: string, context?: Record<string, unknown>) => logger.warn(message, context);
export const logDebug = (message: string, context?: Record<string, unknown>) => logger.debug(message, context);

export default logger;
