import { PrismaClient } from '@/generated/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const databaseUrl = process.env.DATABASE_URL || '';

// MySQL 8 users using caching_sha2_password require the server RSA key during
// authentication when TLS is not enabled. The migrated VPS uses a local
// database connection, so allow the MariaDB driver to retrieve that key.
const adapter = new PrismaMariaDb(
    databaseUrl.includes('?')
        ? `${databaseUrl}&allowPublicKeyRetrieval=true`
        : `${databaseUrl}?allowPublicKeyRetrieval=true`
);

export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        adapter,
        // log: ['query'],
    });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
