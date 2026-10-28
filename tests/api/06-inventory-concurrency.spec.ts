/** DEMO 5 - SQL transactions & concurrent writes: never sell more than you have. */
import { expect, test } from '@playwright/test';
import { addToCart, checkout, freshShopper } from '../support/api';
import { activate, dataset, deactivate, setStock } from '../support/lab';

const PRODUCT = 'dell-xps-13';

test.describe('Inventory under concurrency', () => {
  test('two customers buy the last unit at the same time: exactly one succeeds', async ({ request }) => {
    const a = await freshShopper(request, 31);
    const b = await freshShopper(request, 32);
    await addToCart(request, a.token, PRODUCT);
    await addToCart(request, b.token, PRODUCT);
    await setStock(request, PRODUCT, 1);
    const before = (await dataset(request, 'stock')).find((r) => r.product_id === PRODUCT);

    const [ra, rb] = await Promise.all([checkout(request, a.token), checkout(request, b.token)]);
    const statuses = [ra.status(), rb.status()].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = (await (ra.status() === 409 ? ra : rb).json()).error;
    expect(loser.code).toBe('OUT_OF_STOCK');
    expect(loser.details).toMatchObject({ productId: PRODUCT, requested: 1, available: 0 });

    const after = (await dataset(request, 'stock')).find((r) => r.product_id === PRODUCT);
    expect(after.available).toBe(0);
    expect(after.reserved + after.sold - before.reserved - before.sold).toBe(1);
  });

  test('ten buyers, three units: exactly three orders confirmed', async ({ request }) => {
    const shoppers = await Promise.all(Array.from({ length: 10 }, (_, i) => freshShopper(request, 11 + i)));
    for (const s of shoppers) await addToCart(request, s.token, PRODUCT);
    await setStock(request, PRODUCT, 3);
    const results = await Promise.all(shoppers.map((s) => checkout(request, s.token)));
    const codes = results.map((r) => r.status());
    expect(codes.filter((c) => c === 201)).toHaveLength(3);
    expect(codes.filter((c) => c === 409)).toHaveLength(7);
  });

  test('multi-item order where the 2nd item is out of stock rolls back the 1st (all-or-nothing)', async ({ request }) => {
    const s = await freshShopper(request, 33);
    const thaliBefore = (await (await request.get('/api/inventory/brass-pooja-thali')).json()).available;
    await addToCart(request, s.token, 'brass-pooja-thali');
    await addToCart(request, s.token, 'dyson-v12'); // seeded with 0 stock
    const body = await (await checkout(request, s.token)).json();
    expect(body.error.code).toBe('OUT_OF_STOCK');
    expect(body.order.status).toBe('REJECTED');
    const thaliAfter = (await (await request.get('/api/inventory/brass-pooja-thali')).json()).available;
    expect(thaliAfter).toBe(thaliBefore);
  });

  test('BUG DEMO: the unsafe read-modify-write implementation oversells @slow', async ({ request }) => {
    const a = await freshShopper(request, 34);
    const b = await freshShopper(request, 35);
    await addToCart(request, a.token, PRODUCT);
    await addToCart(request, b.token, PRODUCT);
    await setStock(request, PRODUCT, 1);
    await activate(request, 'unsafe-inventory');
    try {
      const [ra, rb] = await Promise.all([checkout(request, a.token), checkout(request, b.token)]);
      // This is the bug students should learn to catch: both "succeed" for one unit.
      expect([ra.status(), rb.status()]).toEqual([201, 201]);
    } finally {
      await deactivate(request, 'unsafe-inventory');
    }
  });
});
