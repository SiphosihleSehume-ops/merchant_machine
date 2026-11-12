import { PrismaClient } from '@prisma/client';

/**
 * Normalizes DATABASE_URL for Prisma's query engine (especially with Neon PostgreSQL):
 *  - Removes `channel_binding=require` which breaks Prisma's connection pool handshake
 *  - Sets generous `connect_timeout` and `pool_timeout` (30s instead of 5s default)
 *    to handle Neon serverless cold starts
 *  - Caps `connection_limit` on Neon endpoints so connection bursts don't get rejected
 */
export function normalizeDatabaseUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete('channel_binding');
    if (!parsed.searchParams.has('connect_timeout')) {
      parsed.searchParams.set('connect_timeout', '30');
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', '30');
    }
    if (parsed.hostname.includes('neon.tech')) {
      if (!parsed.searchParams.has('sslmode')) {
        parsed.searchParams.set('sslmode', 'require');
      }
      if (!parsed.searchParams.has('connection_limit')) {
        parsed.searchParams.set('connection_limit', '5');
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

const normalizedUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
if (normalizedUrl) {
  process.env.DATABASE_URL = normalizedUrl;
}

const basePrisma = new PrismaClient({
  ...(normalizedUrl ? { datasources: { db: { url: normalizedUrl } } } : {}),
  log: ['info', 'warn', 'error'],
});

// Retry transient connection wake-up errors (e.g. Neon cold start) once automatically
export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        try {
          return await query(args);
        } catch (error: any) {
          const msg = String(error?.message || '');
          if (
            error?.name === 'PrismaClientInitializationError' ||
            error?.code === 'P1001' ||
            msg.includes("Can't reach database server")
          ) {
            await new Promise((r) => setTimeout(r, 1500));
            await basePrisma.$connect().catch(() => undefined);
            return await query(args);
          }
          throw error;
        }
      },
    },
  },
}) as unknown as PrismaClient;
