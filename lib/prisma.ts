import { PrismaClient } from '@prisma/client';
import { validateEnv } from './env';

// Validate environment variables on startup
validateEnv();

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['query'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma; 