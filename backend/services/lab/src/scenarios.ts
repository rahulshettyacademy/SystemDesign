/**
 * Fault-injection scenarios. Each one changes REAL backend behaviour:
 * stopping a container, or flipping a fault switch inside a running service.
 */
import { containerAction } from './docker';
import { sleep } from '@qamart/common';
import { labCall, rabbitApi, redis } from './infra';
import { APP_INSTANCES, instanceUrl, instancesOf } from './topology';

export interface Scenario {
  id: string;
  title: string;
  concept: string;
  mechanism: string;
  expected: string;
  observe: string[];
  activate: () => Promise<unknown>;
  deactivate: () => Promise<unknown>;
}

const fault = (instances: string[], values: Record<string, unknown>) => Promise.all(instances.map((i) => labCall(i, 'PUT', '/faults', values)));
const products = () => instancesOf('product').map((i) => i.id);
const stop = (c: string) => containerAction(c, 'stop');
/** Start a container and wait until the service inside answers, so the next demo step is reliable. */
const start = async (c: string) => {
  const r = await containerAction(c, 'start');
  await waitUntilServing(c.replace('qamart-', ''));
  return r;
};

export async function waitUntilServing(id: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  const probe = async () => {
    if (id === 'redis') return (await redis.ping()) === 'PONG';
    if (id === 'rabbitmq') return !!(await rabbitApi('/overview'));
    const res = await fetch(`${instanceUrl(id)}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  };
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return true;
    await sleep(500);
  }
  return false;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'payment-down', title: 'Payment service unavailable', concept: 'Partial failure',
    mechanism: 'docker stop qamart-payment',
    expected: 'Checkout returns 503 PAYMENT_UNAVAILABLE after 3 quick retries. Order = PAYMENT_FAILED, stock reservation released, cart kept, customer NOT charged. Browsing, search and cart keep working.',
    observe: ['Shop: place an order', 'Traces: 3 failed payment attempts, then inventory release', 'Data: inventory reservation RELEASED, no payment row'],
    activate: () => stop('qamart-payment'), deactivate: () => start('qamart-payment'),
  },
  {
    id: 'payment-timeout', title: 'Payment response timeout (charged, reply lost)', concept: 'Idempotency',
    mechanism: 'payment fault payment.timeoutAfterCharge=first (charge commits, reply delayed 8s)',
    expected: 'Attempt 1 times out after 3s (outcome unknown). Attempt 2 re-sends the SAME idempotency key and gets the ORIGINAL charge back. Exactly one payment row with request_count = 2; order CONFIRMED.',
    observe: ['Traces: "payment attempt 1/3" ends in timeout, attempt 2 returns replayed=true', 'Data -> payments: one row, request_count 2'],
    activate: () => fault(['payment'], { 'payment.timeoutAfterCharge': 'first' }),
    deactivate: () => fault(['payment'], { 'payment.timeoutAfterCharge': null }),
  },
  {
    id: 'payment-blackhole', title: 'Every payment reply times out', concept: 'Eventual consistency',
    mechanism: 'payment fault payment.timeoutAfterCharge=always',
    expected: 'All 3 attempts time out, checkout answers 202 PAYMENT_PENDING (stock stays reserved). ~15-20s later the reconciler asks the payment service by idempotency key, finds SUCCEEDED and confirms the order. One charge only.',
    observe: ['Shop: order page shows "Payment pending" then flips to Confirmed', 'Traces: "reconcile payment" span joins the original trace'],
    activate: () => fault(['payment'], { 'payment.timeoutAfterCharge': 'always' }),
    deactivate: () => fault(['payment'], { 'payment.timeoutAfterCharge': null }),
  },
  {
    id: 'payment-decline', title: 'Payments declined', concept: 'Compensation',
    mechanism: 'payment fault payment.forceDecline=true',
    expected: 'Checkout returns 402 PAYMENT_DECLINED. Order PAYMENT_FAILED, coupon usage and stock reservation are given back (compensating actions).',
    observe: ['Data -> reservations: RELEASED', 'Data -> coupons: used_count unchanged'],
    activate: () => fault(['payment'], { 'payment.forceDecline': true }),
    deactivate: () => fault(['payment'], { 'payment.forceDecline': null }),
  },
  {
    id: 'notification-paused', title: 'Notification consumer stopped', concept: 'Asynchronous messaging',
    mechanism: 'notification consumer cancelled (service still up)',
    expected: 'Orders are still confirmed instantly. OrderCreated messages pile up in notification.order-created (Ready count grows). When resumed, the backlog drains and notifications appear.',
    observe: ['Queues tab: Ready messages increase', 'Shop: order confirmed, "email pending"'],
    activate: () => labCall('notification', 'POST', '/actions/pause-consumer'),
    deactivate: () => labCall('notification', 'POST', '/actions/resume-consumer'),
  },
  {
    id: 'notification-failing', title: 'Notification processing fails', concept: 'Retries & dead-letter queue',
    mechanism: 'notification fault notification.failProcessing=true',
    expected: 'Each message is tried 3 times (5s apart via the .retry queue), then parked in notification.order-created.dlq. The order itself is unaffected. After deactivating, use "Re-drive DLQ" to process them.',
    observe: ['Logs: "will retry" x2 then "moving to dead-letter queue"', 'Queues tab: DLQ count'],
    activate: () => fault(['notification'], { 'notification.failProcessing': true }),
    deactivate: () => fault(['notification'], { 'notification.failProcessing': null }),
  },
  {
    id: 'notification-slow', title: 'Slow notification processing', concept: 'Delayed processing',
    mechanism: 'notification fault notification.processingDelayMs=10000',
    expected: 'Checkout latency is unchanged (async!). The confirmation notification arrives ~10s later.',
    observe: ['Traces: consumer span is 10s long but the HTTP request was fast'],
    activate: () => fault(['notification'], { 'notification.processingDelayMs': 10000 }),
    deactivate: () => fault(['notification'], { 'notification.processingDelayMs': null }),
  },
  {
    id: 'duplicate-delivery', title: 'Duplicate message delivery', concept: 'Idempotent consumers',
    mechanism: 'order fault order.duplicatePublish=true (every event published twice)',
    expected: 'Each consumer receives OrderCreated twice. Notification ignores the duplicate (eventId already processed), inventory commit is a no-op, cart delete removes nothing. Exactly one notification.',
    observe: ['Logs: "Duplicate OrderCreated event ignored"', 'Data -> notifications: one per order'],
    activate: () => fault(['order'], { 'order.duplicatePublish': true }),
    deactivate: () => fault(['order'], { 'order.duplicatePublish': null }),
  },
  {
    id: 'redis-down', title: 'Redis unavailable', concept: 'Graceful degradation',
    mechanism: 'docker stop qamart-redis',
    expected: 'Product pages still load (X-Cache: BYPASS) straight from MongoDB - a bit slower. Product instances report DEGRADED, not DOWN.',
    observe: ['Health: product-1/2/3 DEGRADED', 'Cache tab probe: BYPASS'],
    activate: () => stop('qamart-redis'), deactivate: () => start('qamart-redis'),
  },
  {
    id: 'product-instance-down', title: 'Backend instance stopped (product-2)', concept: 'Load balancing & failover',
    mechanism: 'docker stop qamart-product-2',
    expected: 'Nginx stops routing to product-2 (DNS re-resolution / failed attempts are retried on the next upstream). All product requests succeed via product-1 and product-3. Starting it again restores the three-way split.',
    observe: ['Load Balancer tab: run a burst before and after', 'Traces: Nginx span shows upstream failover'],
    activate: () => stop('qamart-product-2'), deactivate: () => start('qamart-product-2'),
  },
  {
    id: 'product-instance-slow', title: 'One slow instance (product-2 +1.5s)', concept: 'Load balancing limits',
    mechanism: 'product-2 fault http.latencyMs=1500',
    expected: 'Round-robin keeps sending 1/3 of traffic to the slow instance: p95 latency jumps although average looks OK. Passive health checks only notice errors, not slowness.',
    observe: ['Load Balancer tab burst: every third request ~1.5s', 'Health: product-2 DEGRADED'],
    activate: () => fault(['product-2'], { 'http.latencyMs': 1500 }),
    deactivate: () => fault(['product-2'], { 'http.latencyMs': null }),
  },
  {
    id: 'cart-down', title: 'Cart service down', concept: 'Microservices vs monolith',
    mechanism: 'docker stop qamart-cart',
    expected: 'Home, search and product pages keep working; cart and checkout show a friendly error. In a monolith the whole site would share the crash.',
    observe: ['Shop: browse OK, cart shows error', 'Health: cart DOWN'],
    activate: () => stop('qamart-cart'), deactivate: () => start('qamart-cart'),
  },
  {
    id: 'inventory-down', title: 'Inventory service down', concept: 'Partial failure',
    mechanism: 'docker stop qamart-inventory',
    expected: 'Product pages render but stock shows "Availability unknown". Checkout fails safely with 503 INVENTORY_UNAVAILABLE before any payment.',
    observe: ['Shop product page', 'Traces: checkout stops at inventory call'],
    activate: () => stop('qamart-inventory'), deactivate: () => start('qamart-inventory'),
  },
  {
    id: 'unsafe-inventory', title: 'Unsafe stock update (race condition bug)', concept: 'Concurrency',
    mechanism: 'inventory fault inventory.unsafeReservation=true (read-modify-write)',
    expected: 'Run the "Two customers, last item" demo: BOTH orders succeed although only 1 unit existed (oversold). Deactivate and repeat: exactly one succeeds.',
    observe: ['Demos tab: race result', 'Data -> stock: reserved/sold exceeds what existed'],
    activate: () => fault(['inventory'], { 'inventory.unsafeReservation': true }),
    deactivate: () => fault(['inventory'], { 'inventory.unsafeReservation': null }),
  },
  {
    id: 'rabbitmq-down', title: 'Message broker down', concept: 'Transactional outbox',
    mechanism: 'docker stop qamart-rabbitmq',
    expected: 'Orders are still confirmed (events wait in the outbox table). Notifications stop. When RabbitMQ returns, the outbox publisher delivers the backlog automatically.',
    observe: ['Data -> outbox: published_at NULL rows', 'Health: rabbitmq DOWN, services DEGRADED'],
    activate: () => stop('qamart-rabbitmq'), deactivate: () => start('qamart-rabbitmq'),
  },
  {
    id: 'cache-stale', title: 'Stale cache (invalidation disabled)', concept: 'Caching',
    mechanism: 'all product instances: invalidateOnUpdate=false, TTL=120s',
    expected: 'Change a price in the Cache tab: product pages keep showing the OLD price (X-Cache: HIT) until the TTL expires. Checkout still charges the NEW price because it reads the database.',
    observe: ['Cache tab probes', 'Checkout response: priceChanges'],
    activate: () => Promise.all(products().map((i) => labCall(i, 'POST', '/actions/cache-settings', { invalidateOnUpdate: false, ttlSeconds: 120 }))),
    deactivate: () => Promise.all(products().map((i) => labCall(i, 'POST', '/actions/cache-settings', { invalidateOnUpdate: true, ttlSeconds: 60 }))),
  },
  {
    id: 'cache-short-ttl', title: 'Short cache TTL (10s)', concept: 'Caching',
    mechanism: 'all product instances: TTL=10s',
    expected: 'A cached product expires after 10 seconds: HIT, HIT ... then MISS (reloaded from MongoDB).',
    observe: ['Cache tab: watch the TTL count down, probe again after expiry'],
    activate: () => Promise.all(products().map((i) => labCall(i, 'POST', '/actions/cache-settings', { ttlSeconds: 10 }))),
    deactivate: () => Promise.all(products().map((i) => labCall(i, 'POST', '/actions/cache-settings', { ttlSeconds: 60 }))),
  },
];

export const activeScenarios = new Set<string>();

export async function clearAllFaults() {
  return Promise.allSettled(APP_INSTANCES.map((i) => labCall(i.id, 'DELETE', '/faults')));
}
