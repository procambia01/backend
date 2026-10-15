// src/config/database.ts
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from './env';
import logger from '@/utils/logger.util';

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: config.isDevelopment ? ['error', 'warn'] : ['error'],
  });

if (!config.isProduction) {
  globalForPrisma.prisma = prisma;
}

/** The client handed to `$transaction(async (tx) => …)`. */
export type Tx = Prisma.TransactionClient;
/** Either the root client or a transaction client. */
export type Db = PrismaClient | Tx;

/**
 * Geospatial (2dsphere) and a few Mongo-only indexes that Prisma cannot
 * declare in the schema. Idempotent; run on boot and by `npm run db:indexes`.
 */
export async function ensureGeoIndexes(): Promise<void> {
  const defs: Array<{ collection: string; field: string; name: string }> = [
    { collection: 'SwapOffer', field: 'area', name: 'area_2dsphere' },
    { collection: 'User', field: 'areaCenter', name: 'areaCenter_2dsphere' },
    { collection: 'Meetup', field: 'location', name: 'location_2dsphere' },
  ];
  for (const d of defs) {
    try {
      await prisma.$runCommandRaw({
        createIndexes: d.collection,
        indexes: [{ key: { [d.field]: '2dsphere' }, name: d.name }],
      });
    } catch (error) {
      logger.error('Failed to create geo index', { collection: d.collection, message: (error as Error).message });
      throw error;
    }
  }
}

export async function connectDatabase(): Promise<void> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Database connection timed out after 15s. Check DATABASE_URL and network access.')), 15_000)
  );
  await Promise.race([prisma.$connect(), timeout]);
  logger.info('Database connected');
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  } catch (error) {
    logger.error('Error disconnecting from database', { message: (error as Error).message });
  }
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$runCommandRaw({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export default prisma;
