import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const adapter = new PrismaMariaDb(process.env.DATABASE_URL || '');

export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        adapter
        // log: ['query'],
    });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
