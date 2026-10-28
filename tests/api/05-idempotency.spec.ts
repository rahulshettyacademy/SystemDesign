/** DEMO 7 - Distributed systems: duplicates, timeouts and "charged exactly once". */
import { expect, test } from '@playwright/test';
import { addToCart, checkout, freshShopper } from '../support/api';
import { expectSchema } from '../support/contract';
import { activate, deactivate, eventually, newKey } from '../support/lab';

test.describe('Idempotency', () => {
  test('re-sending the same Idempotency-Key returns the original order (200 + Idempotent-Replay)', async ({ request }) => {
    const s = await freshShopper(request, 48);
    await addToCart(request, s.token, 'brass-pooja-thali');
    const key = newKey();
    const first = await checkout(request, s.token, { key });
    expect(first.status()).toBe(201);
    const again = await checkout(request, s.token, { key });
    expect(again.status()).toBe(200);
    expect(again.headers()['idempotent-replay']).toBe('true');
    expect((await again.json()).id).toBe((await first.json()).id);
  });

  test('two identical requests at the same moment create ONE order and ONE charge', async ({ request }) => {
    const s = await freshShopper(request, 48);
    await addToCart(request, s.token, 'led-string-lights');
    const key = newKey();
    const [a, b] = await Promise.all([checkout(request, s.token, { key }), checkout(request, s.token, { key })]);
    const statuses = [a.status(), b.status()].sort();
    // one wins (201); the other either sees it in progress (409) or replays it (200)
    expect(statuses[1]).toBe(201);
    expect([200, 409]).toContain(statuses[0]);
    const orders = (await (await request.get('/api/orders', { headers: s.headers })).json()).items.filter((o: any) => o.items[0].productId === 'led-string-lights');
    expect(orders).toHaveLength(1);
    const payments = (await (await request.get(`/api/payments?orderId=${orders[0].id}`, { headers: s.headers })).json()).items;
    expect(payments).toHaveLength(1);
  });

  test('payment response times out after the charge: retry with same key => charged ONCE @slow', async ({ request }) => {
    const s = await freshShopper(request, 49);
    await addToCart(request, s.token, 'noise-colorfit-pro5');
    await activate(request, 'payment-timeout');
    try {
      const res = await checkout(request, s.token);
      expect(res.status()).toBe(201);
      const order = await res.json();
      expect(order.status).toBe('CONFIRMED');
      const payments = (await (await request.get(`/api/payments?orderId=${order.id}`, { headers: s.headers })).json()).items;
      expectSchema({ items: payments }, 'PaymentList');
      expect(payments).toHaveLength(1); // exactly one charge...
      expect(payments[0].requestCount).toBe(2); // ...although the payment service received two requests
    } finally {
      await deactivate(request, 'payment-timeout');
    }
  });

  test('every reply lost: order is PAYMENT_PENDING, then reconciled to CONFIRMED @slow', async ({ request }) => {
    test.setTimeout(90_000);
    const s = await freshShopper(request, 49);
    await addToCart(request, s.token, 'instant-pot-6l');
    await activate(request, 'payment-blackhole');
    let orderId: string;
    try {
      const res = await checkout(request, s.token);
      expect(res.status()).toBe(202);
      const body = await res.json();
      expect(body.error.code).toBe('PAYMENT_PENDING');
      expect(body.order.status).toBe('PAYMENT_PENDING');
      orderId = body.order.id;
    } finally {
      await deactivate(request, 'payment-blackhole');
    }
    const confirmed = await eventually(async () => {
      const o = await (await request.get(`/api/orders/${orderId}`, { headers: s.headers })).json();
      return o.status === 'CONFIRMED' && o;
    }, 45_000, 2000);
    expect(confirmed.events.at(-1).note).toContain('reconciliation');
    const payments = (await (await request.get(`/api/payments?orderId=${orderId!}`, { headers: s.headers })).json()).items;
    expect(payments).toHaveLength(1);
  });
});
