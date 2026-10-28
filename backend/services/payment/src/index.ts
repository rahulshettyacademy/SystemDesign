/**
 * PAYMENT SERVICE — a SIMULATED payment provider (Postgres payment_db). No real cards, ever.
 *
 * Idempotency: every charge request carries an Idempotency-Key. The key is UNIQUE in the
 * database, so a retried request can never create a second charge — it gets the original result.
 *
 * Demo payment methods:
 *   demo_success  -> approved after ~300 ms
 *   demo_slow     -> approved after ~2 s
 *   demo_decline  -> declined (simulated insufficient funds)
 */
import { randomUUID } from 'node:crypto';
import {
  ApiError, createDb, createService, Faults, log, requireAuth, requireInternal, requiredEnv, sleep, validate, z,
} from '@qamart/common';

const db = createDb(requiredEnv('DATABASE_URL'), 'payment_db');
const svc = createService();
const { app } = svc;

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id              UUID PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      order_id        UUID NOT NULL,
      user_id         UUID NOT NULL,
      amount          INT  NOT NULL CHECK (amount > 0),
      currency        TEXT NOT NULL DEFAULT 'INR',
      method          TEXT NOT NULL,
      status          TEXT NOT NULL CHECK (status IN ('PROCESSING','SUCCEEDED','DECLINED')),
      decline_reason  TEXT,
      request_count   INT  NOT NULL DEFAULT 1,   -- how many times this key was received
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

const view = (p: any, replayed: boolean) => ({
  paymentId: p.id, idempotencyKey: p.idempotency_key, orderId: p.order_id, amount: p.amount, currency: p.currency,
  method: p.method, status: p.status, declineReason: p.decline_reason, requestCount: p.request_count, replayed,
  createdAt: p.created_at,
});

const ChargeBody = z.object({
  idempotencyKey: z.string().min(8).max(100),
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  amount: z.number().int().positive(),
  method: z.enum(['demo_success', 'demo_decline', 'demo_slow']),
});

app.post('/internal/payments', requireInternal, async (req, res) => {
  const body = validate(ChargeBody, req.body);
  const timeoutMode = Faults.get('payment.timeoutAfterCharge', 'off' as string);
  const delayMs = Number(Faults.get('payment.timeoutDelayMs', 8000));

  // INSERT or bump request_count atomically. xmax = 0 means "this statement inserted the row".
  const { rows } = await db.query(
    `INSERT INTO payments (id, idempotency_key, order_id, user_id, amount, method, status)
     VALUES ($1,$2,$3,$4,$5,$6,'PROCESSING')
     ON CONFLICT (idempotency_key) DO UPDATE SET request_count = payments.request_count + 1, updated_at = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [randomUUID(), body.idempotencyKey, body.orderId, body.userId, body.amount, body.method],
  );
  let payment = rows[0];

  if (!payment.inserted) {
    if (payment.amount !== body.amount || payment.order_id !== body.orderId) {
      throw new ApiError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different payment');
    }
    log.info('Duplicate charge request: returning the ORIGINAL result, no new charge', {
      idempotencyKey: body.idempotencyKey, status: payment.status, requestCount: payment.request_count,
    });
    if (payment.status === 'PROCESSING') throw new ApiError(409, 'PAYMENT_IN_PROGRESS', 'The original payment is still being processed', view(payment, true));
    if (timeoutMode === 'always') await sleep(delayMs);
    res.status(200).json(view(payment, true));
    return;
  }

  // ---- simulated card network ----
  log.info('Processing new charge', { amount: body.amount, method: body.method });
  await sleep(body.method === 'demo_slow' ? 2000 : 300);
  const declined = body.method === 'demo_decline' || Faults.get('payment.forceDecline', false);
  const upd = await db.query(
    `UPDATE payments SET status = $2, decline_reason = $3, updated_at = now() WHERE id = $1 RETURNING *`,
    [payment.id, declined ? 'DECLINED' : 'SUCCEEDED', declined ? 'Insufficient funds (simulated)' : null],
  );
  payment = upd.rows[0];
  log.info(declined ? 'Payment DECLINED' : 'Payment SUCCEEDED - customer charged', { paymentId: payment.id, amount: payment.amount });

  if (timeoutMode === 'first' || timeoutMode === 'always') {
    // The charge is COMMITTED, but the caller will give up waiting before we answer.
    log.warn(`Injected fault: charge committed but response delayed ${delayMs}ms (caller will time out)`, { paymentId: payment.id });
    await sleep(delayMs);
  }
  res.status(201).json(view(payment, false));
});

app.get('/internal/payments/by-key/:key', requireInternal, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM payments WHERE idempotency_key = $1', [req.params.key]);
  if (!rows[0]) throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'No payment with that idempotency key');
  res.json(view(rows[0], false));
});

/** Customers can see the charges for their own orders (admins can see any). */
app.get('/api/payments', requireAuth, async (req, res) => {
  const orderId = validate(z.string().uuid('must be a valid order id'), req.query.orderId, 'orderId');
  const admin = req.user!.role === 'admin';
  const { rows } = await db.query(
    `SELECT * FROM payments WHERE order_id = $1 ${admin ? '' : 'AND user_id = $2'} ORDER BY created_at`,
    admin ? [orderId] : [orderId, req.user!.id],
  );
  res.json({ items: rows.map((p) => view(p, false)) });
});

svc.healthCheck('postgres', db.ping);
svc.onLabReset(async () => {
  await db.query('TRUNCATE payments');
});

(async () => {
  await db.waitUntilReady();
  await migrate();
  await svc.start();
})();
