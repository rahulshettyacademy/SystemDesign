/**
 * DEMO 1 - Frontend, backend & APIs: product search.
 * Positive, negative and contract checks on the product service (via the gateway).
 */
import { expect, test } from '@playwright/test';
import { expectError } from '../support/api';
import { expectSchema } from '../support/contract';

test.describe('Product search API', () => {
  test('search for "iphone" returns matching products that satisfy the contract', async ({ request }) => {
    const res = await request.get('/api/products?q=iphone');
    expect(res.status()).toBe(200);
    expect(res.headers()['x-request-id']).toMatch(/^[a-f0-9]{32}$/);
    const body = await res.json();
    expectSchema(body, 'SearchResult');
    expect(body.total).toBeGreaterThanOrEqual(2);
    for (const p of body.items) expect(`${p.name} ${p.tags ?? ''}`.toLowerCase()).toContain('iphone');
  });

  test('search is case-insensitive and matches brand', async ({ request }) => {
    const upper = await (await request.get('/api/products?q=SAMSUNG')).json();
    const lower = await (await request.get('/api/products?q=samsung')).json();
    expect(upper.total).toBe(lower.total);
    expect(upper.items.every((p: any) => p.brand === 'Samsung')).toBe(true);
  });

  test('sorting by price ascending returns non-decreasing prices', async ({ request }) => {
    const body = await (await request.get('/api/products?sort=price_asc&limit=50')).json();
    const prices = body.items.map((p: any) => p.price);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
  });

  test('pagination: page 2 does not repeat page 1', async ({ request }) => {
    const p1 = await (await request.get('/api/products?limit=5&page=1')).json();
    const p2 = await (await request.get('/api/products?limit=5&page=2')).json();
    expect(p1.totalPages).toBe(Math.ceil(p1.total / 5));
    const ids1 = p1.items.map((p: any) => p.id);
    expect(p2.items.some((p: any) => ids1.includes(p.id))).toBe(false);
  });

  test('a search with no matches returns 200 and an empty list (not 404)', async ({ request }) => {
    const body = await (await request.get('/api/products?q=zzz-not-a-product')).json();
    expect(body).toMatchObject({ items: [], total: 0 });
  });

  test('invalid query parameters return 400 VALIDATION_ERROR with field details', async ({ request }) => {
    const body = await expectError(await request.get('/api/products?limit=500&page=0'), 400, 'VALIDATION_ERROR');
    expectSchema(body, 'Error');
    const fields = body.error.details.map((d: any) => d.field).sort();
    expect(fields).toEqual(['limit', 'page']);
  });

  test('unknown query parameters are rejected (strict API)', async ({ request }) => {
    await expectError(await request.get('/api/products?colour=red'), 400, 'VALIDATION_ERROR');
  });

  test('unknown category is rejected', async ({ request }) => {
    await expectError(await request.get('/api/products?category=toys'), 400, 'VALIDATION_ERROR');
  });

  test('product details satisfy the contract; documents differ by category (NoSQL)', async ({ request }) => {
    const phone = await (await request.get('/api/products/iphone-15-128')).json();
    const kurta = await (await request.get('/api/products/silk-kurta-men')).json();
    expectSchema(phone, 'ProductDetail');
    expectSchema(kurta, 'ProductDetail');
    expect(phone.specs).toHaveProperty('chip');
    expect(phone.variants).toBeNull();
    expect(kurta.specs).toBeNull();
    expect(kurta.variants).toHaveProperty('size');
  });

  test('unknown product returns 404, malformed id returns 400', async ({ request }) => {
    await expectError(await request.get('/api/products/does-not-exist'), 404, 'PRODUCT_NOT_FOUND');
    const bad = await expectError(await request.get('/api/products/BAD_ID!'), 400, 'VALIDATION_ERROR');
    expect(bad.error.details[0].field).toBe('id');
  });

  test('categories and stock endpoints satisfy their contracts', async ({ request }) => {
    expectSchema(await (await request.get('/api/products/categories')).json(), 'CategoryList');
    const stock = await (await request.get('/api/inventory?productIds=iphone-15-128,dyson-v12')).json();
    expectSchema(stock, 'StockList');
    expect(stock.items.find((s: any) => s.productId === 'dyson-v12').status).toBe('OUT_OF_STOCK');
  });

  test('unknown API routes return a JSON 404 from the gateway', async ({ request }) => {
    await expectError(await request.get('/api/does-not-exist'), 404, 'NOT_FOUND');
  });

  test('a caller-supplied X-Request-ID is propagated (correlation)', async ({ request }) => {
    const res = await request.get('/api/products?q=pixel', { headers: { 'x-request-id': 'student-test-0001' } });
    expect(res.headers()['x-request-id']).toBe('student-test-0001');
  });
});
