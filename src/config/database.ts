// src/config/database.ts
import { PrismaClient } from '@prisma/client';
import { config } from './env';
import logger from '@/utils/logger.util';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: config.isDevelopment ? ['error', 'warn'] : ['error'],
  });

if (config.isDevelopment) {
  globalForPrisma.prisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  // Skip if already connected (prevents double-connect from module re-evaluation)
  try {
    await prisma.$runCommandRaw({ ping: 1 });
    logger.info('✅ Database already connected, skipping reconnect');
    return;
  } catch {
    // Not connected yet — proceed
  }

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            'Database connection timed out after 15s.\n' +
              '  → Check DATABASE_URL in .env\n' +
              '  → Check MongoDB Atlas → Network Access → 0.0.0.0/0 is Active\n' +
              '  → Run: npx prisma generate'
          )
        ),
      15_000
    )
  );

  try {
    await Promise.race([prisma.$connect(), timeout]);
    logger.info('✅ Database connected successfully');
  } catch (error) {
    logger.error('❌ Database connection failed:', (error as Error).message);
    process.exit(1);
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  } catch (error) {
    logger.error('Error disconnecting from database:', error);
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
