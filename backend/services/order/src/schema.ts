import { Db, log } from '@qamart/common';

export async function migrate(db: Db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS coupons (
      code           TEXT PRIMARY KEY,
      description    TEXT NOT NULL,
      type           TEXT NOT NULL CHECK (type IN ('PERCENT','FLAT')),
      value          INT  NOT NULL CHECK (value > 0),
      max_discount   INT,
      min_subtotal   INT  NOT NULL DEFAULT 0,
      active         BOOLEAN NOT NULL DEFAULT true,
      sale_only      BOOLEAN NOT NULL DEFAULT false,
      valid_until    TIMESTAMPTZ,
      usage_limit    INT,
      used_count     INT NOT NULL DEFAULT 0,
      per_user_limit INT,
      CHECK (usage_limit IS NULL OR used_count <= usage_limit)
    );
    CREATE SEQUENCE IF NOT EXISTS order_number_seq START 100001;
    CREATE TABLE IF NOT EXISTS orders (
      id               UUID PRIMARY KEY,
      order_number     TEXT NOT NULL UNIQUE,
      user_id          UUID NOT NULL,
      user_email       TEXT NOT NULL,
      user_name        TEXT NOT NULL,
      idempotency_key  TEXT NOT NULL,
      status           TEXT NOT NULL CHECK (status IN ('PENDING','PAYMENT_PENDING','CONFIRMED','PAYMENT_FAILED','REJECTED')),
      subtotal         INT  NOT NULL CHECK (subtotal > 0),
      discount         INT  NOT NULL DEFAULT 0 CHECK (discount >= 0),
      total            INT  NOT NULL CHECK (total >= 0),
      coupon_code      TEXT REFERENCES coupons(code),
      payment_method   TEXT NOT NULL,
      payment_id       UUID,
      failure_code     TEXT,
      failure_reason   TEXT,
      shipping_address JSONB NOT NULL,
      trace_id         TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, idempotency_key)          -- the database guarantees one order per checkout attempt
    );
    CREATE TABLE IF NOT EXISTS order_items (
      order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      name       TEXT NOT NULL,
      unit_price INT  NOT NULL CHECK (unit_price > 0),
      quantity   INT  NOT NULL CHECK (quantity > 0),
      line_total INT  NOT NULL,
      PRIMARY KEY (order_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS order_events (
      id         BIGSERIAL PRIMARY KEY,
      order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status     TEXT NOT NULL,
      note       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS coupon_redemptions (
      order_id    UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
      coupon_code TEXT NOT NULL REFERENCES coupons(code),
      user_id     UUID NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- TRANSACTIONAL OUTBOX: events are written in the SAME transaction as the order update,
    -- then a background publisher moves them to RabbitMQ. No "order saved but event lost".
    CREATE TABLE IF NOT EXISTS outbox (
      id           BIGSERIAL PRIMARY KEY,
      event_id     UUID NOT NULL UNIQUE,
      event_type   TEXT NOT NULL,
      routing_key  TEXT NOT NULL,
      payload      JSONB NOT NULL,
      trace_id     TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      published_at TIMESTAMPTZ,
      attempts     INT NOT NULL DEFAULT 0,
      last_error   TEXT
    );`);
}

export async function seedCoupons(db: Db, force = false) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM coupons');
  if (rows[0].n > 0 && !force) return;
  await db.tx(async (q) => {
    if (force) {
      await q('TRUNCATE outbox, order_events, coupon_redemptions, order_items, orders, coupons');
      await q('ALTER SEQUENCE order_number_seq RESTART WITH 100001');
    }
    const coupons: unknown[][] = [
      ['WELCOME10', '10% off your order (max ₹1,000)', 'PERCENT', 10, 1000, 0, true, false, null, null, null],
      ['FLAT500', '₹500 off on orders above ₹5,000', 'FLAT', 500, null, 5000, true, false, null, null, null],
      ['DIWALI50', 'Diwali special: 50% off (max ₹2,000), once per customer', 'PERCENT', 50, 2000, 999, false, true, null, 100, 1],
      ['LIMITED1', '₹1,000 off - only ONE customer can use this', 'FLAT', 1000, null, 2000, true, false, null, 1, null],
      ['EXPIRED20', '20% off (expired)', 'PERCENT', 20, null, 0, true, false, '2025-01-01T00:00:00Z', null, null],
    ];
    for (const c of coupons) {
      await q(
        `INSERT INTO coupons (code, description, type, value, max_discount, min_subtotal, active, sale_only, valid_until, usage_limit, per_user_limit)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        c,
      );
    }
  });
  log.info('Seeded coupons');
}
