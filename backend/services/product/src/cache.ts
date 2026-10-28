/**
 * CACHE-ASIDE with Redis.
 *   read:  GET product:<id>  -> HIT: return it
 *                            -> MISS: read MongoDB, SET product:<id> EX <ttl>, return it
 *   write: update MongoDB, then DEL product:<id> (invalidation) — can be switched off to demo stale data
 * If Redis is down we skip the cache (BYPASS) and serve from MongoDB: slower, but still correct.
 */
import Redis from 'ioredis';
import { log, withSpan } from '@qamart/common';

export const cacheSettings = {
  ttlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 60),
  invalidateOnUpdate: true,
  enabled: true,
};
export const DEFAULT_CACHE_SETTINGS = { ...cacheSettings };

export const cacheStats = { hits: 0, misses: 0, bypass: 0, errors: 0, invalidations: 0 };

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
  // Fail fast instead of queueing commands while Redis is down: the DB fallback kicks in immediately.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  connectTimeout: 1000,
  commandTimeout: 500,
  retryStrategy: (times) => Math.min(times * 500, 3000),
});
let lastRedisError = 0;
redis.on('error', (e) => {
  if (Date.now() - lastRedisError > 10_000) log.warn('Redis connection problem', { error: e.message });
  lastRedisError = Date.now();
});
redis.on('ready', () => log.info('Connected to Redis'));

export const productKey = (id: string) => `product:${id}`;

export type CacheResult<T> = { value: T | null; status: 'HIT' | 'MISS' | 'BYPASS'; ttl?: number };

export async function cacheAside<T>(id: string, loadFromDb: () => Promise<T | null>): Promise<CacheResult<T>> {
  const key = productKey(id);
  if (!cacheSettings.enabled) {
    cacheStats.bypass++;
    return { value: await loadFromDb(), status: 'BYPASS' };
  }

  let cached: string | null = null;
  let redisOk = true;
  try {
    cached = await withSpan('Redis GET', 'cache', { 'db.system': 'redis', key }, async (span) => {
      const v = await redis.get(key);
      span.setAttribute('cache.hit', v !== null);
      return v;
    });
  } catch (e) {
    redisOk = false;
    cacheStats.errors++;
    log.warn('Redis unavailable, falling back to MongoDB', { key, error: (e as Error).message });
  }

  if (cached !== null) {
    cacheStats.hits++;
    const ttl = await redis.ttl(key).catch(() => -1);
    log.info('Cache HIT', { key, ttlRemaining: ttl });
    return { value: JSON.parse(cached) as T, status: 'HIT', ttl };
  }

  const value = await loadFromDb();
  if (!redisOk) {
    cacheStats.bypass++;
    return { value, status: 'BYPASS' };
  }
  cacheStats.misses++;
  log.info('Cache MISS - loaded from MongoDB', { key });
  if (value !== null) {
    await withSpan('Redis SET', 'cache', { 'db.system': 'redis', key, ttlSeconds: cacheSettings.ttlSeconds }, () =>
      redis.set(key, JSON.stringify(value), 'EX', cacheSettings.ttlSeconds),
    ).catch((e) => log.warn('Could not populate cache', { key, error: (e as Error).message }));
  }
  return { value, status: 'MISS', ttl: cacheSettings.ttlSeconds };
}

export async function invalidate(id: string) {
  await withSpan('Redis DEL', 'cache', { 'db.system': 'redis', key: productKey(id) }, () => redis.del(productKey(id)));
  cacheStats.invalidations++;
  log.info('Cache invalidated', { key: productKey(id) });
}

export async function flushProductKeys() {
  const keys = await redis.keys('product:*');
  if (keys.length) await redis.del(...keys);
  return keys.length;
}
