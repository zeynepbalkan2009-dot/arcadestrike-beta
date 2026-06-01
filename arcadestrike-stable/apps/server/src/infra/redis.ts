/**
 * Redis client — graceful degradation.
 *
 * Redis is OPTIONAL for local dev. If REDIS_URL is empty or
 * connection fails, the server continues with in-memory fallbacks.
 * No crash loop on missing Redis.
 */
import IORedis from 'ioredis';
import { logger } from '../utils/logger';

type RedisStatus = 'connected' | 'disconnected' | 'disabled';

let _redis: IORedis | null = null;
let _status: RedisStatus = 'disabled';

export function getRedis(): IORedis | null {
  return _redis;
}

export function getRedisStatus(): RedisStatus {
  return _status;
}

export async function initRedis(): Promise<void> {
  const url = process.env.REDIS_URL;

  if (!url || url.trim() === '') {
    logger.warn('[Redis] REDIS_URL not set — running without Redis (in-memory fallback active)');
    _status = 'disabled';
    return;
  }

  return new Promise((resolve) => {
    const client = new IORedis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 5000,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.warn(`[Redis] Could not connect after ${times} attempts — continuing without Redis`);
          return null; // stop retrying
        }
        return Math.min(times * 500, 2000);
      },
    });

    const done = (connected: boolean) => {
      if (connected) {
        _redis = client;
        _status = 'connected';
        logger.info('[Redis] connected');
      } else {
        _status = 'disconnected';
        logger.warn('[Redis] unavailable — in-memory fallback active');
        client.disconnect();
      }
      resolve();
    };

    const timer = setTimeout(() => done(false), 6000);

    client.once('ready', () => { clearTimeout(timer); done(true); });
    client.once('error', (err) => {
      clearTimeout(timer);
      logger.warn({ err: err.message }, '[Redis] connection error');
      done(false);
    });

    client.connect().catch(() => done(false));
  });
}

export async function disconnectRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit().catch(() => _redis!.disconnect());
    _redis = null;
    _status = 'disconnected';
  }
}
