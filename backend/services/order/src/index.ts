/**
 * ORDER SERVICE — owns orders, coupons and the event outbox (Postgres order_db).
 * Coordinates checkout across cart, product, inventory and payment.
 */
import {
  ApiError, callService, config, createDb, createService, Faults, log, Rabbit, requireAuth, requiredEnv, runInTrace,
  suppressTracing, UpstreamError, validate, withSpan, z,
} from '@qamart/common';
import { checkout, paymentKeyFor } from './checkout';
import { evaluateCoupon } from './coupons';
import { confirmOrder, failOrder, loadOrder, toView } from './orders';
import { migrate, seedCoupons } from './schema';

const db = createDb(requiredEnv('DATABASE_URL'), 'order_db');
const rabbit = new Rabbit(requiredEnv('RABBITMQ_URL'));
const PAYMENT_URL = process.env.PAYMENT_URL ?? 'http://payment:3000';
const svc = createService();
const { app } = svc;

// ---------------------------------------------------------------- coupons
app.get('/api/coupons', async (_req, res) => {
  const { rows } = await db.query(
    `SELECT code, description, min_subtotal FROM coupons WHERE active AND (valid_until IS NULL OR valid_until > now())
       AND (usage_limit IS NULL OR used_count < usage_limit) ORDER BY code`,
  );
  res.json({ items: rows.map((r) => ({ code: r.code, description: r.description, minSubtotal: r.min_subtotal })) });
});

const CouponCheck = z.object({
  code: z.string().trim().min(1, 'is required').max(30),
  subtotal: z.number({ message: 'must be a number' }).int().positive('must be > 0'),
}).strict();

app.post('/api/coupons/validate', requireAuth, async (req, res) => {
  const body = validate(CouponCheck, req.body);
  const r = await evaluateCoupon(db.query, body.code, body.subtotal, req.user!.id);
  res.json({ valid: true, ...r, totalAfterDiscount: body.subtotal - r.discount });
});

// ---------------------------------------------------------------- orders
app.use('/api/orders', requireAuth);

const CheckoutBody = z.object({
  couponCode: z.string().trim().max(30).optional().transform((v) => v || undefined),
  paymentMethod: z.enum(['demo_success', 'demo_decline', 'demo_slow'], { message: 'must be demo_success, demo_decline or demo_slow' }),
  shippingAddress: z.object({
    name: z.string().trim().min(2, 'is required').max(80),
    line1: z.string().trim().min(5, 'must be at least 5 characters').max(200),
    city: z.string().trim().min(2, 'is required').max(80),
    pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'must be a valid 6-digit PIN code'),
    phone: z.string().regex(/^[6-9][0-9]{9}$/, 'must be a valid 10-digit mobile number'),
  }),
}).strict();

app.post('/api/orders', async (req, res) => {
  const key = req.header('idempotency-key');
  if (!key) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (e.g. a UUID) so retries cannot create duplicate orders');
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new ApiError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key must be 8-100 characters of letters, digits, - or _');
  const body = validate(CheckoutBody, req.body);
  const outcome = await checkout(db, req.user!, { idempotencyKey: key, ...body }, req.requestId);
  if (outcome.replayed) res.setHeader('Idempotent-Replay', 'true');
  res.status(outcome.httpStatus).json(outcome.error ? { error: { ...outcome.error, requestId: req.requestId }, order: outcome.order } : outcome.order);
});

app.get('/api/orders', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user!.id]);
  const items = rows.length
    ? (await db.query('SELECT * FROM order_items WHERE order_id = ANY($1)', [rows.map((r) => r.id)])).rows
    : [];
  res.json({ items: rows.map((o) => toView(o, items.filter((i) => i.order_id === o.id))) });
});

app.get('/api/orders/:id', async (req, res) => {
  const id = validate(z.string().uuid('must be a valid order id'), req.params.id, 'id');
  const order = await loadOrder(db.query, id);
  // Other customers' orders return 404 (not 403) so we don't reveal that the ID exists.
  if (!order || ((await ownerOf(id)) !== req.user!.id && req.user!.role !== 'admin')) {
    throw new ApiError(404, 'ORDER_NOT_FOUND', `Order ${id} not found`);
  }
  res.json(order);
});

async function ownerOf(id: string) {
  const { rows } = await db.query('SELECT user_id FROM orders WHERE id = $1', [id]);
  return rows[0]?.user_id;
}

// ---------------------------------------------------------------- outbox publisher
async function publishOutbox() {
  if (!rabbit.connected) return; // events stay safely in the outbox until RabbitMQ is back
  const { rows } = await suppressTracing(() =>
    db.query('SELECT * FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 20'),
  );
  for (const row of rows) {
    await runInTrace(row.trace_id, undefined, async () => {
      try {
        await rabbit.publish(row.routing_key, row.payload, { messageId: row.event_id, eventType: row.event_type, traceId: row.trace_id });
        if (Faults.get('order.duplicatePublish', false)) {
          log.warn('Injected fault: publishing the SAME event twice (simulated duplicate delivery)', { eventId: row.event_id });
          await rabbit.publish(row.routing_key, row.payload, { messageId: row.event_id, eventType: row.event_type, traceId: row.trace_id });
        }
        await db.query('UPDATE outbox SET published_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1', [row.id]);
        log.info('Event published from outbox', { eventId: row.event_id, eventType: row.event_type });
      } catch (e) {
        await suppressTracing(() => db.query('UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [row.id, (e as Error).message]));
        if (row.attempts % 20 === 0) log.warn('Outbox publish failed; will retry', { eventId: row.event_id, error: (e as Error).message });
      }
    });
  }
}

// ---------------------------------------------------------------- payment reconciler
/**
 * Orders stuck in PAYMENT_PENDING (e.g. the payment response timed out) are resolved by
 * ASKING the payment service what happened to the idempotency key. This is how we never
 * double-charge and never lose a paid order.
 */
async function reconcilePayments() {
  const { rows } = await suppressTracing(() =>
    db.query(`SELECT id, trace_id, updated_at FROM orders WHERE status = 'PAYMENT_PENDING' AND updated_at < now() - interval '15 seconds' LIMIT 10`),
  );
  for (const o of rows) {
    await runInTrace(o.trace_id, undefined, () =>
      withSpan('reconcile payment', 'internal', { orderId: o.id, job: 'payment-reconciler' }, async () => {
        try {
          const { data: p } = await callService('payment', `${PAYMENT_URL}/internal/payments/by-key/${paymentKeyFor(o.id)}`, { timeoutMs: 2000 });
          if (p.status === 'SUCCEEDED') {
            log.info('Reconciler: payment had SUCCEEDED - confirming order', { orderId: o.id, paymentId: p.paymentId });
            await confirmOrder(db, o.id, p.paymentId, `Payment confirmed by reconciliation (charged once, ${p.requestCount} request(s) received)`);
          } else if (p.status === 'DECLINED') {
            await failOrder(db, o.id, 'PAYMENT_FAILED', 'PAYMENT_DECLINED', p.declineReason ?? 'Payment declined');
          }
        } catch (e) {
          if (e instanceof UpstreamError && e.status === 404) {
            if (Date.now() - new Date(o.updated_at).getTime() > 60_000) {
              log.warn('Reconciler: payment never reached the provider - failing order safely', { orderId: o.id });
              await failOrder(db, o.id, 'PAYMENT_FAILED', 'PAYMENT_NOT_RECEIVED', 'Payment was never received by the provider. You were not charged.');
            }
          } else {
            log.warn('Reconciler: payment service not reachable, will retry', { orderId: o.id, error: (e as Error).message });
          }
        }
      }),
    );
  }
}

let publishing = false;
setInterval(() => {
  if (publishing) return;
  publishing = true;
  publishOutbox().catch(() => undefined).finally(() => (publishing = false));
}, 500);
let reconciling = false;
setInterval(() => {
  if (reconciling) return;
  reconciling = true;
  reconcilePayments().catch(() => undefined).finally(() => (reconciling = false));
}, 5000);

// ---------------------------------------------------------------- lab hooks
svc.healthCheck('postgres', db.ping);
svc.healthCheck('rabbitmq', () => rabbit.ping(), false); // outbox buffers events while RabbitMQ is down
svc.setLabInfo(async () => {
  const { rows } = await db.query(`SELECT count(*) FILTER (WHERE published_at IS NULL)::int AS pending, count(*)::int AS total FROM outbox`);
  return { outbox: rows[0], paymentTimeoutMs: Number(process.env.PAYMENT_TIMEOUT_MS ?? 3000) };
});
svc.labAction('set-sale', async (b: { active: boolean }) => {
  await db.query(`UPDATE coupons SET active = $1 WHERE sale_only`, [!!b.active]);
  return { saleCoupons: (await db.query('SELECT code, active FROM coupons WHERE sale_only')).rows };
});
svc.labAction('republish', async (b: { orderId?: string }) => {
  const r = b.orderId
    ? await db.query(`UPDATE outbox SET published_at = NULL WHERE payload->>'orderId' = $1 RETURNING event_id`, [b.orderId])
    : await db.query(`UPDATE outbox SET published_at = NULL WHERE id = (SELECT max(id) FROM outbox WHERE published_at IS NOT NULL) RETURNING event_id`);
  log.warn('Instructor requested re-publishing of an already-delivered event', { events: r.rows.map((x) => x.event_id) });
  return { republished: r.rows.map((x) => x.event_id) };
});
svc.onLabReset(() => seedCoupons(db, true));

(async () => {
  await db.waitUntilReady();
  await migrate(db);
  await seedCoupons(db);
  void rabbit.connect();
  await svc.start();
  log.info('Order service ready', { instance: config.instance });
})();
