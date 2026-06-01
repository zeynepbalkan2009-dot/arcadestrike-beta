/**
 * Prisma singleton — lazy initialization.
 *
 * WHY LAZY:
 *   PrismaClient reads DATABASE_URL at construction time.
 *   If this module is imported at the top of index.ts before
 *   dotenv.config() runs, DATABASE_URL is undefined → crash.
 *   Lazy init guarantees env is already loaded by call time.
 */
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

let _client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_client) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        '[Prisma] DATABASE_URL is not set. ' +
        'Ensure .env is loaded before any Prisma call.'
      );
    }
    _client = new PrismaClient({
      log:
        process.env.NODE_ENV === 'development'
          ? [
              { emit: 'event', level: 'query' },
              { emit: 'event', level: 'error' },
              { emit: 'event', level: 'warn' },
            ]
          : [{ emit: 'event', level: 'error' }],
    });

    if (process.env.NODE_ENV === 'development') {
      (_client as any).$on('query', (e: any) => {
        logger.debug({ duration: e.duration, query: e.query }, '[Prisma] query');
      });
    }

    (_client as any).$on('error', (e: any) => {
      logger.error({ message: e.message }, '[Prisma] error');
    });
  }
  return _client;
}

export async function disconnectPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
    logger.info('[Prisma] disconnected');
  }
}

/** Convenience re-export for files that prefer a named import */
export { PrismaClient };
