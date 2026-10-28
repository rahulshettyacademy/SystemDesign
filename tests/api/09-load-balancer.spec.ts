/** DEMO 3 - Load balancing: distribution, failover, recovery. */
import { expect, test } from '@playwright/test';
import { activate, deactivate } from '../support/lab';

async function hits(request: any, n: number) {
  const counts: Record<string, number> = {};
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = await request.get('/api/products?limit=1');
    statuses.push(r.status());
    const by = r.headers()['x-served-by'] ?? 'none';
    counts[by] = (counts[by] ?? 0) + 1;
  }
  return { counts, statuses };
}

test.describe('Load balancer', () => {
  test('round robin spreads requests evenly over 3 instances', async ({ request }) => {
    const { counts } = await hits(request, 30);
    expect(Object.keys(counts).sort()).toEqual(['product-1', 'product-2', 'product-3']);
    // Assert with a tolerance: other traffic (e.g. the shop polling) can shift the rotation slightly.
    for (const c of Object.values(counts)) expect(c).toBeGreaterThanOrEqual(8);
  });

  test('an instance goes down: traffic fails over; it comes back: traffic rebalances @slow', async ({ request }) => {
    test.setTimeout(90_000);
    await activate(request, 'product-instance-down');
    try {
      await new Promise((r) => setTimeout(r, 6000)); // let DNS-based discovery notice (resolver valid=5s)
      const { counts, statuses } = await hits(request, 20);
      expect(statuses.every((s) => s === 200)).toBe(true);
      expect(counts['product-2']).toBeUndefined();
    } finally {
      await deactivate(request, 'product-instance-down');
    }
    await new Promise((r) => setTimeout(r, 6000));
    const { counts } = await hits(request, 30);
    expect(counts['product-2']).toBeGreaterThan(0);
  });

  test('a slow instance still receives its share of traffic (LB does not see slowness) @slow', async ({ request }) => {
    await activate(request, 'product-instance-slow');
    try {
      const timings: Record<string, number[]> = {};
      for (let i = 0; i < 9; i++) {
        const t = Date.now();
        const r = await request.get('/api/products?limit=1');
        (timings[r.headers()['x-served-by']] ??= []).push(Date.now() - t);
      }
      expect(timings['product-2']).toHaveLength(3);
      expect(Math.min(...timings['product-2'])).toBeGreaterThan(1400);
    } finally {
      await deactivate(request, 'product-instance-slow');
    }
  });
});
