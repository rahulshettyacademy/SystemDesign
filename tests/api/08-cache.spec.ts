/** DEMO 4 - Redis cache-aside: miss, hit, TTL, stale data, invalidation, Redis outage. */
import { expect, test } from '@playwright/test';
import { activate, deactivate, lab } from '../support/lab';

const ID = 'galaxy-s24-256';
const get = (request: any) => request.get(`/api/products/${ID}`);
const setPrice = (request: any, price: number) => lab(request, 'POST', `/products/${ID}/price`, { price });

test.describe('Product cache', () => {
  test.beforeEach(async ({ request }) => {
    await lab(request, 'POST', '/cache/invalidate', { id: ID });
  });

  test('first read is a MISS, the next reads are HITs (from ANY instance: the cache is shared)', async ({ request }) => {
    const first = await get(request);
    expect(first.headers()['x-cache']).toBe('MISS');
    const servedBy = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const r = await get(request);
      expect(r.headers()['x-cache']).toBe('HIT');
      servedBy.add(r.headers()['x-served-by']);
    }
    expect(servedBy.size).toBe(3);
  });

  test('a price update invalidates the cached entry (next read is a MISS with the new price)', async ({ request }) => {
    await get(request);
    await setPrice(request, 71999);
    const r = await get(request);
    expect(r.headers()['x-cache']).toBe('MISS');
    expect((await r.json()).price).toBe(71999);
    await setPrice(request, 74999);
  });

  test('with invalidation disabled the cache serves a STALE price', async ({ request }) => {
    await activate(request, 'cache-stale');
    try {
      expect((await (await get(request)).json()).price).toBe(74999);
      await setPrice(request, 70000);
      const stale = await get(request);
      expect(stale.headers()['x-cache']).toBe('HIT');
      expect((await stale.json()).price).toBe(74999); // stale!
      await lab(request, 'POST', '/cache/invalidate', { id: ID });
      expect((await (await get(request)).json()).price).toBe(70000);
    } finally {
      await deactivate(request, 'cache-stale');
      await setPrice(request, 74999);
    }
  });

  test('entries expire after their TTL @slow', async ({ request }) => {
    test.setTimeout(40_000);
    await activate(request, 'cache-short-ttl'); // TTL = 10 s
    try {
      expect((await get(request)).headers()['x-cache']).toBe('MISS');
      const ttl = Number((await get(request)).headers()['x-cache-ttl']);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
      await new Promise((r) => setTimeout(r, (ttl + 1.5) * 1000));
      expect((await get(request)).headers()['x-cache']).toBe('MISS');
    } finally {
      await deactivate(request, 'cache-short-ttl');
    }
  });

  test('Redis down: product pages still work from MongoDB (BYPASS) @slow', async ({ request }) => {
    test.setTimeout(60_000);
    await activate(request, 'redis-down');
    try {
      const r = await get(request);
      expect(r.status()).toBe(200);
      expect(r.headers()['x-cache']).toBe('BYPASS');
    } finally {
      await deactivate(request, 'redis-down');
    }
  });
});
