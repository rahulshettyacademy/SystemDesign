/**
 * Scripted demonstrations. They drive REAL traffic through the public Nginx edge, exactly
 * like a browser would, and return the request IDs so the dashboard can show the traces.
 */
import { randomUUID } from 'node:crypto';
import { newTraceId } from '@qamart/common';
import { labCall, pg } from './infra';

const EDGE = process.env.EDGE_URL ?? 'http://nginx:8080';
const PASSWORD = 'Password@123';
const ADDRESS = { name: 'Alice Sharma', line1: '12 MG Road, Indiranagar', city: 'Bengaluru', pincode: '560038', phone: '9876543210' };

export interface Step {
  step: string;
  method: string;
  path: string;
  status: number;
  requestId: string;
  ms: number;
  servedBy?: string | null;
  cache?: string | null;
  body?: any;
}

export async function edge(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string>; step?: string } = {}): Promise<Step> {
  const requestId = newTraceId();
  const t = Date.now();
  const res = await fetch(`${EDGE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* html error page */
  }
  return {
    step: opts.step ?? `${method} ${path}`, method, path, status: res.status, requestId: res.headers.get('x-request-id') ?? requestId,
    ms: Date.now() - t, servedBy: res.headers.get('x-served-by'), cache: res.headers.get('x-cache'), body,
  };
}

export async function login(user: string) {
  const r = await edge('POST', '/api/auth/login', { body: { email: `${user}@qamart.test`, password: PASSWORD }, step: `Login as ${user}` });
  if (r.status !== 200) throw new Error(`Login failed for ${user}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

async function prepareCart(token: string, productId: string, quantity = 1) {
  await edge('DELETE', '/api/cart', { token });
  return edge('POST', '/api/cart/items', { token, body: { productId, quantity }, step: `Add ${productId} to cart` });
}

const brief = (s: Step) => {
  const b = s.body;
  return {
    ...s,
    body: undefined,
    summary: b?.error ? `${b.error.code}: ${b.error.message}` : b?.orderNumber ? `${b.orderNumber} ${b.status}` : b?.total !== undefined && b?.items ? `${b.items.length} results` : undefined,
    orderStatus: b?.status ?? b?.order?.status,
    orderNumber: b?.orderNumber ?? b?.order?.orderNumber,
    errorCode: b?.error?.code,
  };
};

/** The full customer journey from the course outline, step by step. */
export async function journey(opts: { paymentMethod?: string; coupon?: string; productId?: string } = {}) {
  const productId = opts.productId ?? 'iphone-15-128';
  const steps: Step[] = [];
  steps.push(await edge('GET', '/api/products?q=iphone', { step: '1. Search "iphone"' }));
  steps.push(await edge('GET', `/api/products/${productId}`, { step: '2. View product details' }));
  steps.push(await edge('GET', `/api/inventory/${productId}`, { step: '3. Check stock availability' }));
  const token = await login('alice');
  await edge('DELETE', '/api/cart', { token });
  steps.push(await edge('POST', '/api/cart/items', { token, body: { productId, quantity: 1 }, step: '4. Add to cart' }));
  const coupon = opts.coupon ?? 'WELCOME10';
  const cart = steps[steps.length - 1].body;
  steps.push(await edge('POST', '/api/coupons/validate', { token, body: { code: coupon, subtotal: cart?.subtotal ?? 1 }, step: `5. Apply coupon ${coupon}` }));
  const couponOk = steps[steps.length - 1].status === 200;
  steps.push(await edge('POST', '/api/orders', {
    token, step: '6-8. Checkout: reserve stock, pay, place order',
    headers: { 'idempotency-key': randomUUID() },
    body: { paymentMethod: opts.paymentMethod ?? 'demo_success', couponCode: couponOk ? coupon : undefined, shippingAddress: ADDRESS },
  }));
  const order = steps[steps.length - 1].body;
  const orderId = order?.id ?? order?.order?.id;
  if (orderId) {
    await new Promise((r) => setTimeout(r, 1500)); // give the async consumers a moment
    steps.push(await edge('GET', `/api/notifications?orderId=${orderId}`, { token, step: '9. Order confirmation (notification)' }));
    steps.push(await edge('GET', '/api/orders', { token, step: '10. Order history' }));
  }
  return { steps: steps.map(brief) };
}

/** Just "Place order" as alice (adds one item first). */
export async function placeOrder(opts: { paymentMethod?: string; productId?: string }) {
  const token = await login('alice');
  const add = await prepareCart(token, opts.productId ?? 'airpods-pro-2');
  const order = await edge('POST', '/api/orders', {
    token, step: 'Place order', headers: { 'idempotency-key': randomUUID() },
    body: { paymentMethod: opts.paymentMethod ?? 'demo_success', shippingAddress: ADDRESS },
  });
  return { steps: [brief(add), brief(order)] };
}

/** Two customers try to buy the LAST unit at the same moment. */
export async function raceLastItem(opts: { productId?: string }) {
  const productId = opts.productId ?? 'iphone-15-pro-256';
  await labCall('inventory', 'POST', '/actions/set-stock', { items: [{ productId, available: 1 }] });
  const [alice, bob] = await Promise.all([login('alice'), login('bob')]);
  await Promise.all([prepareCart(alice, productId), prepareCart(bob, productId)]);
  const before = (await pg.inventory_db.query('SELECT available, reserved, sold FROM stock WHERE product_id = $1', [productId])).rows[0];
  const results = await Promise.all(
    [['alice', alice], ['bob', bob]].map(async ([user, token]) => {
      const s = await edge('POST', '/api/orders', {
        token, step: `${user} checks out`, headers: { 'idempotency-key': randomUUID() },
        body: { paymentMethod: 'demo_success', shippingAddress: { ...ADDRESS, name: user } },
      });
      return { user, ...brief(s) };
    }),
  );
  await new Promise((r) => setTimeout(r, 1000));
  const after = (await pg.inventory_db.query('SELECT available, reserved, sold FROM stock WHERE product_id = $1', [productId])).rows[0];
  const winners = results.filter((r) => r.status === 201).length;
  return {
    productId, stockBefore: before, stockAfter: after, results, winners, unitsSoldThisRun: after.sold - before.sold,
    verdict: winners > 1 ? `OVERSOLD: ${winners} customers bought 1 unit` : winners === 1 ? 'Correct: exactly one customer got the last unit' : 'Nobody bought it (check faults)',
  };
}

/** The same checkout submitted twice at once (double-click) and once more later (retry). */
export async function duplicateOrder() {
  const token = await login('alice');
  await prepareCart(token, 'jbl-flip-6');
  const key = randomUUID();
  const send = (label: string) =>
    edge('POST', '/api/orders', { token, step: label, headers: { 'idempotency-key': key }, body: { paymentMethod: 'demo_success', shippingAddress: ADDRESS } });
  const concurrent = await Promise.all([send('Request A (double click)'), send('Request B (double click)')]);
  const retry = await send('Request C (retry 1s later)').then(async (r) => r);
  const orders = (await pg.order_db.query('SELECT id, order_number, status FROM orders WHERE idempotency_key = $1', [key])).rows;
  const payments = orders[0] ? (await pg.payment_db.query('SELECT id, status, request_count FROM payments WHERE order_id = $1', [orders[0].id])).rows : [];
  return {
    idempotencyKey: key,
    requests: [...concurrent, retry].map((s) => ({ ...brief(s), replayed: s.status === 200 })),
    ordersInDatabase: orders,
    paymentsInDatabase: payments,
    verdict: orders.length === 1 && payments.length <= 1 ? 'Correct: one order, at most one charge' : `BUG: ${orders.length} orders / ${payments.length} payments`,
  };
}

export async function probeProduct(id: string) {
  const s = await edge('GET', `/api/products/${id}`, { step: 'Probe product' });
  return { requestId: s.requestId, status: s.status, cache: s.cache, servedBy: s.servedBy, ms: s.ms, price: s.body?.price, name: s.body?.name, at: Date.now() };
}

export async function lbBurst(count: number, path: string) {
  const results: Array<{ i: number; status: number; servedBy: string | null; ms: number; requestId: string }> = [];
  for (let i = 1; i <= count; i++) {
    try {
      const s = await edge('GET', path);
      results.push({ i, status: s.status, servedBy: s.servedBy ?? null, ms: s.ms, requestId: s.requestId });
    } catch (e) {
      results.push({ i, status: 0, servedBy: null, ms: 0, requestId: '' });
    }
  }
  const distribution: Record<string, number> = {};
  for (const r of results) distribution[r.servedBy ?? 'failed'] = (distribution[r.servedBy ?? 'failed'] ?? 0) + 1;
  return { path, count, distribution, results };
}
