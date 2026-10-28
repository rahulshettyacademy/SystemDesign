/**
 * INVENTORY SERVICE — owns stock levels and reservations (Postgres inventory_db).
 * Demonstrates SQL transactions, CHECK constraints, row locks, rollbacks and
 * how a naive read-modify-write causes OVERSELLING under concurrency.
 */
import { randomUUID } from 'node:crypto';
import {
  ApiError, createDb, createService, Faults, log, Query, Rabbit, requireInternal, requiredEnv, sleep, suppressTracing, validate, z,
} from '@qamart/common';

const db = createDb(requiredEnv('DATABASE_URL'), 'inventory_db');
const rabbit = new Rabbit(requiredEnv('RABBITMQ_URL'));
const svc = createService();
const { app } = svc;

/** Deterministic starting stock (product IDs match the catalog service). */
const SEED_STOCK: Record<string, number> = {
  'iphone-15-128': 25, 'iphone-15-pro-256': 12, 'galaxy-s24-256': 30, 'pixel-8-128': 18, 'oneplus-12-256': 22,
  'macbook-air-m3': 10, 'dell-xps-13': 6, 'thinkpad-e14': 14, 'airpods-pro-2': 40, 'sony-wh1000xm5': 15,
  'boat-airdopes-141': 120, 'jbl-flip-6': 35, 'apple-watch-s9': 20, 'noise-colorfit-pro5': 80, 'samsung-tv-55-qled': 8,
  'mi-tv-43': 16, 'diya-set-12': 200, 'led-string-lights': 150, 'brass-pooja-thali': 45, 'silk-kurta-men': 60,
  'banarasi-saree': 3, 'instant-pot-6l': 25, 'dyson-v12': 0, 'kindle-paperwhite': 28,
};
const LOW_STOCK = 5;

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS stock (
      product_id TEXT PRIMARY KEY,
      available  INT NOT NULL CHECK (available >= 0),   -- the database itself refuses negative stock
      reserved   INT NOT NULL DEFAULT 0 CHECK (reserved >= 0),
      sold       INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id         UUID PRIMARY KEY,
      order_id   UUID NOT NULL UNIQUE,                  -- one reservation per order => idempotent reserve
      status     TEXT NOT NULL CHECK (status IN ('HELD','COMMITTED','RELEASED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS reservation_items (
      reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
      product_id     TEXT NOT NULL REFERENCES stock(product_id),
      quantity       INT  NOT NULL CHECK (quantity > 0),
      PRIMARY KEY (reservation_id, product_id)
    );`);
}

async function seed(force = false) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM stock');
  if (rows[0].n > 0 && !force) return;
  await db.tx(async (q) => {
    await q('TRUNCATE reservation_items, reservations, stock');
    for (const [id, qty] of Object.entries(SEED_STOCK)) {
      await q('INSERT INTO stock (product_id, available) VALUES ($1, $2)', [id, qty]);
    }
  });
  log.info('Seeded stock levels', { products: Object.keys(SEED_STOCK).length });
}

const view = (r: { product_id: string; available: number }) => ({
  productId: r.product_id,
  available: r.available,
  status: r.available === 0 ? 'OUT_OF_STOCK' : r.available <= LOW_STOCK ? 'LOW_STOCK' : 'IN_STOCK',
});

// ---------------------------------------------------------------- public API
app.get('/api/inventory', async (req, res) => {
  const ids = String(req.query.productIds ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw new ApiError(400, 'VALIDATION_ERROR', 'productIds query parameter is required', [{ field: 'productIds', message: 'comma-separated list is required' }]);
  if (ids.length > 50) throw new ApiError(400, 'VALIDATION_ERROR', 'At most 50 productIds', [{ field: 'productIds', message: 'max 50 ids' }]);
  const { rows } = await db.query('SELECT product_id, available FROM stock WHERE product_id = ANY($1)', [ids]);
  res.json({ items: rows.map(view) });
});

app.get('/api/inventory/:productId', async (req, res) => {
  const { rows } = await db.query('SELECT product_id, available FROM stock WHERE product_id = $1', [req.params.productId]);
  if (!rows[0]) throw new ApiError(404, 'PRODUCT_NOT_FOUND', `No stock record for ${req.params.productId}`);
  res.json(view(rows[0]));
});

// ---------------------------------------------------------------- internal API
const ReserveBody = z.object({
  orderId: z.string().uuid(),
  items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
});

/** SAFE: a conditional UPDATE. Postgres row-locks the stock row, so two buyers of the last unit serialise. */
async function reserveSafely(q: Query, productId: string, quantity: number) {
  const r = await q(
    `UPDATE stock SET available = available - $2, reserved = reserved + $2, updated_at = now()
      WHERE product_id = $1 AND available >= $2 RETURNING available`,
    [productId, quantity],
  );
  return r.rowCount === 1;
}

/**
 * UNSAFE (fault inventory.unsafeReservation): classic read-modify-write race.
 * Both requests read available=1, both write available=0, both "succeed" => oversold.
 */
async function reserveUnsafely(q: Query, productId: string, quantity: number) {
  const { rows } = await q('SELECT available FROM stock WHERE product_id = $1', [productId]);
  if (!rows[0] || rows[0].available < quantity) return false;
  await sleep(300); // widen the race window so the bug is reproducible in class
  await q('UPDATE stock SET available = $2, reserved = reserved + $3, updated_at = now() WHERE product_id = $1', [productId, rows[0].available - quantity, quantity]);
  log.warn('UNSAFE reservation used (read-modify-write)', { productId, readAvailable: rows[0].available });
  return true;
}

app.post('/internal/reservations', requireInternal, async (req, res) => {
  const body = validate(ReserveBody, req.body);
  const existing = await db.query('SELECT id, status FROM reservations WHERE order_id = $1', [body.orderId]);
  if (existing.rows[0]) {
    log.info('Reservation already exists for order (idempotent replay)', { orderId: body.orderId });
    res.status(200).json({ reservationId: existing.rows[0].id, orderId: body.orderId, status: existing.rows[0].status, replayed: true });
    return;
  }
  const unsafe = Faults.get('inventory.unsafeReservation', false);
  // Sort by product id so concurrent multi-item orders lock rows in the same order (no deadlocks).
  const items = [...body.items].sort((a, b) => a.productId.localeCompare(b.productId));
  const reservationId = randomUUID();
  await db.tx(async (q) => {
    await q(`INSERT INTO reservations (id, order_id, status) VALUES ($1, $2, 'HELD')`, [reservationId, body.orderId]);
    for (const item of items) {
      const ok = unsafe ? await reserveUnsafely(q, item.productId, item.quantity) : await reserveSafely(q, item.productId, item.quantity);
      if (!ok) {
        const { rows } = await q('SELECT available FROM stock WHERE product_id = $1', [item.productId]);
        log.warn('Insufficient stock - rolling back the whole reservation', { productId: item.productId, requested: item.quantity, available: rows[0]?.available ?? 0 });
        // Throwing inside db.tx() => ROLLBACK: earlier items in this order are un-reserved automatically.
        throw new ApiError(409, 'OUT_OF_STOCK', `Not enough stock for ${item.productId}`, {
          productId: item.productId, requested: item.quantity, available: rows[0]?.available ?? 0,
        });
      }
      await q('INSERT INTO reservation_items (reservation_id, product_id, quantity) VALUES ($1, $2, $3)', [reservationId, item.productId, item.quantity]);
    }
  });
  log.info('Stock reserved', { orderId: body.orderId, reservationId, items });
  res.status(201).json({ reservationId, orderId: body.orderId, status: 'HELD', replayed: false });
});

async function transition(orderId: string, to: 'COMMITTED' | 'RELEASED') {
  return db.tx(async (q) => {
    const { rows } = await q('SELECT id, status FROM reservations WHERE order_id = $1 FOR UPDATE', [orderId]);
    const r = rows[0];
    if (!r) return { orderId, status: 'NOT_FOUND' };
    if (r.status === to) return { orderId, status: to, replayed: true }; // idempotent
    if (r.status !== 'HELD') throw new ApiError(409, 'INVALID_RESERVATION_STATE', `Reservation is ${r.status}, cannot become ${to}`);
    const items = await q('SELECT product_id, quantity FROM reservation_items WHERE reservation_id = $1', [r.id]);
    for (const it of items.rows) {
      if (to === 'COMMITTED') {
        await q('UPDATE stock SET reserved = reserved - $2, sold = sold + $2, updated_at = now() WHERE product_id = $1', [it.product_id, it.quantity]);
      } else {
        await q('UPDATE stock SET reserved = reserved - $2, available = available + $2, updated_at = now() WHERE product_id = $1', [it.product_id, it.quantity]);
      }
    }
    await q('UPDATE reservations SET status = $2, updated_at = now() WHERE id = $1', [r.id, to]);
    log.info(`Reservation ${to.toLowerCase()}`, { orderId, reservationId: r.id });
    return { orderId, status: to, replayed: false };
  });
}

app.post('/internal/reservations/:orderId/release', requireInternal, async (req, res) => {
  res.json(await transition(validate(z.string().uuid(), req.params.orderId), 'RELEASED'));
});
app.post('/internal/reservations/:orderId/commit', requireInternal, async (req, res) => {
  res.json(await transition(validate(z.string().uuid(), req.params.orderId), 'COMMITTED'));
});

// ---------------------------------------------------------------- async: OrderCreated => commit
rabbit.consume({
  queue: 'inventory.order-created',
  bindings: ['order.created'],
  handler: async (event: { orderId: string }) => {
    const r = await transition(event.orderId, 'COMMITTED');
    if (r.replayed) log.info('Duplicate OrderCreated ignored (reservation already committed)', { orderId: event.orderId });
  },
});

/** Safety net: reservations abandoned for 30 minutes go back on the shelf. */
setInterval(() => {
  void suppressTracing(async () => {
    const { rows } = await db.query(`SELECT order_id FROM reservations WHERE status = 'HELD' AND created_at < now() - interval '30 minutes'`);
    for (const r of rows) await transition(r.order_id, 'RELEASED').catch(() => undefined);
  }).catch(() => undefined);
}, 60_000);

// ---------------------------------------------------------------- lab hooks
svc.healthCheck('postgres', db.ping);
svc.healthCheck('rabbitmq', () => rabbit.ping(), false);
svc.labAction('set-stock', async (b: { items: Array<{ productId: string; available: number }> }) => {
  for (const it of b.items ?? []) {
    await db.query('UPDATE stock SET available = $2, updated_at = now() WHERE product_id = $1', [it.productId, Math.max(0, Math.round(it.available))]);
  }
  log.warn('Stock levels overridden by instructor', { items: b.items });
  const { rows } = await db.query('SELECT product_id, available, reserved, sold FROM stock WHERE product_id = ANY($1)', [(b.items ?? []).map((i) => i.productId)]);
  return { items: rows };
});
svc.onLabReset(() => seed(true));

(async () => {
  await db.waitUntilReady();
  await migrate();
  await seed();
  void rabbit.connect();
  await svc.start();
})();
