/**
 * DIWALI SALE - reproducible LOCAL load test (k6).
 *
 * The production target is 100,000 concurrent users. A laptop running 15 containers cannot
 * (and should not) generate that. This script runs a SMALL, repeatable version of the same
 * traffic shape so students can observe behaviour, then extrapolate (see STUDENT_ASSIGNMENTS.md).
 *
 *   k6 run load/diwali-sale.js                  # ~2 min, up to 40 browsing VUs + buyers
 *   k6 run -e PROFILE=smoke load/diwali-sale.js # 20 s sanity check
 *
 * Traffic mix:
 *   browsers - anonymous: home -> search -> product page -> stock        (read-heavy, cacheable)
 *   buyers   - logged in: add a limited-stock deal to cart -> checkout   (write-heavy, contended)
 *
 * What to watch while it runs: Teaching Dashboard -> Load balancer, Cache, Messaging, Health.
 */
import http from 'k6/http';
import exec from 'k6/execution';
import { check, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const LAB = __ENV.LAB_URL || 'http://localhost:8081';
const PROFILE = __ENV.PROFILE || 'local';
const PASSWORD = 'Password@123';

const DEALS = ['iphone-15-128', 'boat-airdopes-141', 'samsung-tv-55-qled', 'diya-set-12', 'noise-colorfit-pro5'];
const SEARCHES = ['iphone', 'diya', 'tv', 'headphones', 'saree', 'watch', 'laptop'];

const ordersConfirmed = new Counter('orders_confirmed');
const ordersSoldOut = new Counter('orders_sold_out');
const ordersPending = new Counter('orders_payment_pending');
const checkoutTime = new Trend('checkout_duration', true);

const profiles = {
  smoke: {
    browsers: { executor: 'constant-vus', vus: 3, duration: '20s' },
    buyers: { executor: 'constant-arrival-rate', rate: 1, timeUnit: '1s', duration: '20s', preAllocatedVUs: 5, maxVUs: 10 },
  },
  local: {
    browsers: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '30s', target: 40 }, { duration: '60s', target: 40 }, { duration: '10s', target: 0 }] },
    buyers: {
      executor: 'ramping-arrival-rate', startRate: 1, timeUnit: '1s', preAllocatedVUs: 10, maxVUs: 45,
      stages: [{ duration: '30s', target: 5 }, { duration: '60s', target: 5 }, { duration: '10s', target: 0 }],
    },
  },
};

export const options = {
  scenarios: {
    browsers: { ...profiles[PROFILE].browsers, exec: 'browse' },
    buyers: { ...profiles[PROFILE].buyers, exec: 'buy' },
  },
  thresholds: {
    'http_req_duration{scenario:browsers}': ['p(95)<500'], // browsing must stay fast under load
    'checkout_duration': ['p(95)<2000'],
    http_req_failed: ['rate<0.01'], // 402/409 are EXPECTED business outcomes, see responseCallback
    checks: ['rate>0.99'],
  },
};

// Sold out (409) and declined (402) are valid answers during a sale, not errors.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 402, 409));

export function setup() {
  const sale = http.post(`${LAB}/lab/api/sale`, JSON.stringify({ active: true }), { headers: { 'content-type': 'application/json' } });
  check(sale, { 'Diwali sale activated': (r) => r.status === 200 });
  const limited = {};
  for (const d of sale.json('deals') || []) if (d.limitedStock !== null) limited[d.id] = d.limitedStock;

  const tokens = [];
  for (let i = 1; i <= 45; i++) {
    const email = `loadtest${String(i).padStart(2, '0')}@qamart.test`;
    const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email, password: PASSWORD }), { headers: { 'content-type': 'application/json' } });
    tokens.push(r.json('token'));
  }
  // Baseline so teardown counts only units committed DURING this run.
  const rows = http.get(`${LAB}/lab/api/data/stock`).json('rows');
  const baseline = {};
  for (const id of Object.keys(limited)) {
    const row = rows.find((r) => r.product_id === id);
    baseline[id] = row.sold + row.reserved;
  }
  console.log(`Sale active. Limited stock: ${JSON.stringify(limited)}`);
  return { tokens, limited, baseline };
}

export function browse() {
  group('browse', () => {
    http.get(`${BASE}/api/products/sale`, { tags: { name: 'GET /api/products/sale' } });
    const q = SEARCHES[Math.floor(Math.random() * SEARCHES.length)];
    const s = http.get(`${BASE}/api/products?q=${q}`, { tags: { name: 'GET /api/products?q' } });
    check(s, { 'search 200': (r) => r.status === 200 });
    const id = DEALS[Math.floor(Math.random() * DEALS.length)];
    const p = http.get(`${BASE}/api/products/${id}`, { tags: { name: 'GET /api/products/:id' } });
    check(p, { 'product 200': (r) => r.status === 200 });
    http.get(`${BASE}/api/inventory/${id}`, { tags: { name: 'GET /api/inventory/:id' } });
  });
  sleep(Math.random() * 2 + 0.5); // think time
}

export function buy(data) {
  const token = data.tokens[(exec.vu.idInTest - 1) % data.tokens.length];
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const productId = DEALS[Math.floor(Math.random() * DEALS.length)];
  group('buy', () => {
    http.del(`${BASE}/api/cart`, null, { headers, tags: { name: 'DELETE /api/cart' } });
    const add = http.post(`${BASE}/api/cart/items`, JSON.stringify({ productId, quantity: 1 }), { headers, tags: { name: 'POST /api/cart/items' } });
    check(add, { 'added to cart': (r) => r.status === 201 });
    const key = `k6-${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${Date.now()}`;
    const order = http.post(
      `${BASE}/api/orders`,
      JSON.stringify({ paymentMethod: 'demo_success', shippingAddress: { name: 'Load Tester', line1: '1 Sale Street', city: 'Mumbai', pincode: '400001', phone: '9000000000' } }),
      { headers: { ...headers, 'idempotency-key': key }, tags: { name: 'POST /api/orders' }, timeout: '30s' },
    );
    checkoutTime.add(order.timings.duration);
    check(order, { 'checkout answered 201 / 202 / 409': (r) => [201, 202, 409].includes(r.status) });
    if (order.status === 201) ordersConfirmed.add(1);
    else if (order.status === 409) ordersSoldOut.add(1);
    else if (order.status === 202) ordersPending.add(1);
  });
}

export function teardown(data) {
  // THE most important assertion of a flash sale: we never sold more than we had.
  const stock = http.get(`${LAB}/lab/api/data/stock`).json('rows');
  for (const [productId, initial] of Object.entries(data.limited)) {
    const row = stock.find((r) => r.product_id === productId);
    const committed = row.sold + row.reserved - data.baseline[productId];
    const ok = committed <= initial && row.available >= 0;
    console.log(`${ok ? 'OK       ' : 'OVERSOLD!'} ${productId}: limited stock ${initial}, units sold during the sale ${committed}, available now ${row.available}`);
  }
  http.post(`${LAB}/lab/api/sale`, JSON.stringify({ active: false }), { headers: { 'content-type': 'application/json' } });
  console.log('Sale ended. Run the lab reset (dashboard or scripts/reset.sh) before the next demo.');
}
