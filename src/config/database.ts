// src/config/database.ts
import { PrismaClient } from '@prisma/client';
import { config } from './env';
import logger from '@/utils/logger.util';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: config.isDevelopment ? ['query', 'error', 'warn'] : ['error'],
  });

if (config.isDevelopment) {
  globalForPrisma.prisma = prisma;
}

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('✅ Database connected successfully');
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
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
  } catch (error) {
    logger.error('Database health check failed:', error);
    return false;
  }
}

export default prisma;