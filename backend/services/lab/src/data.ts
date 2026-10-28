/** Curated READ-ONLY queries for the dashboard's Data tab (uses the lab_readonly roles). */
import { mongo, pg, redis } from './infra';

interface Dataset {
  title: string;
  store: string;
  query: string;
}
type Runner = () => Promise<any[]>;

const sql = (db: string, query: string): Runner => async () => (await pg[db].query(query)).rows;

export const DATASETS: Record<string, Dataset> = {
  orders: { title: 'Orders', store: 'PostgreSQL / order_db', query: `SELECT order_number, status, user_email, subtotal, discount, total, coupon_code, failure_code, idempotency_key, created_at FROM orders ORDER BY created_at DESC LIMIT 25` },
  order_items: { title: 'Order items (FK -> orders)', store: 'PostgreSQL / order_db', query: `SELECT o.order_number, i.product_id, i.unit_price, i.quantity, i.line_total FROM order_items i JOIN orders o ON o.id = i.order_id ORDER BY o.created_at DESC LIMIT 25` },
  order_events: { title: 'Order status timeline', store: 'PostgreSQL / order_db', query: `SELECT o.order_number, e.status, e.note, e.created_at FROM order_events e JOIN orders o ON o.id = e.order_id ORDER BY e.id DESC LIMIT 30` },
  outbox: { title: 'Outbox (events waiting / published)', store: 'PostgreSQL / order_db', query: `SELECT id, event_type, payload->>'orderNumber' AS order_number, event_id, created_at, published_at, attempts, last_error FROM outbox ORDER BY id DESC LIMIT 25` },
  coupons: { title: 'Coupons', store: 'PostgreSQL / order_db', query: `SELECT code, type, value, max_discount, min_subtotal, active, valid_until, usage_limit, used_count, per_user_limit FROM coupons ORDER BY code` },
  payments: { title: 'Payments (simulated)', store: 'PostgreSQL / payment_db', query: `SELECT id, idempotency_key, amount, method, status, decline_reason, request_count, created_at FROM payments ORDER BY created_at DESC LIMIT 25` },
  stock: { title: 'Stock levels', store: 'PostgreSQL / inventory_db', query: `SELECT product_id, available, reserved, sold, updated_at FROM stock ORDER BY product_id` },
  reservations: { title: 'Stock reservations', store: 'PostgreSQL / inventory_db', query: `SELECT r.order_id, r.status, string_agg(i.product_id || ' x' || i.quantity, ', ') AS items, r.created_at, r.updated_at FROM reservations r JOIN reservation_items i ON i.reservation_id = r.id GROUP BY r.id ORDER BY r.created_at DESC LIMIT 25` },
  carts: { title: 'Cart items', store: 'PostgreSQL / cart_db', query: `SELECT user_id, product_id, unit_price, quantity, added_at FROM cart_items ORDER BY added_at DESC LIMIT 50` },
  users: { title: 'Users (password hashes hidden)', store: 'PostgreSQL / auth_db', query: `SELECT id, email, name, role FROM users ORDER BY email LIMIT 60` },
  products: { title: 'Product documents', store: 'MongoDB / catalog_db.products', query: `db.products.find({}).limit(30)` },
  notifications: { title: 'Notifications', store: 'MongoDB / notification_db.notifications', query: `db.notifications.find({}).sort({createdAt:-1}).limit(25)` },
  cache: { title: 'Redis cache keys', store: 'Redis', query: `SCAN 0 MATCH product:* ; TTL <key>` },
};

const runners: Record<string, Runner> = {
  orders: sql('order_db', DATASETS.orders.query),
  order_items: sql('order_db', DATASETS.order_items.query),
  order_events: sql('order_db', DATASETS.order_events.query),
  outbox: sql('order_db', DATASETS.outbox.query),
  coupons: sql('order_db', DATASETS.coupons.query),
  payments: sql('payment_db', DATASETS.payments.query),
  stock: sql('inventory_db', DATASETS.stock.query),
  reservations: sql('inventory_db', DATASETS.reservations.query),
  carts: sql('cart_db', DATASETS.carts.query),
  users: sql('auth_db', DATASETS.users.query),
  products: async () => mongo.db('catalog_db').collection('products').find({}).limit(30).toArray(),
  notifications: async () => mongo.db('notification_db').collection('notifications').find({}).sort({ createdAt: -1 }).limit(25).toArray(),
  cache: cacheKeys,
};

export async function cacheKeys() {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', 'product:*', 'COUNT', 200);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0' && keys.length < 200);
  const rows = await Promise.all(
    keys.sort().map(async (key) => {
      const [ttl, raw] = await Promise.all([redis.ttl(key), redis.get(key)]);
      const v = raw ? JSON.parse(raw) : null;
      return { key, ttlSeconds: ttl, price: v?.price, name: v?.name, cachedUpdatedAt: v?.updatedAt };
    }),
  );
  return rows;
}

export async function runDataset(id: string) {
  const d = DATASETS[id];
  if (!d) throw new Error(`Unknown dataset ${id}`);
  const rows = await runners[id]();
  return { id, title: d.title, store: d.store, query: d.query, rows };
}

export const datasetList = () => Object.entries(DATASETS).map(([id, d]) => ({ id, title: d.title, store: d.store }));
