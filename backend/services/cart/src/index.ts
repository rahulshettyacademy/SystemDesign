/**
 * CART SERVICE — owns shopping carts (Postgres cart_db).
 * Calls the product service (through the internal load balancer) to snapshot name/price.
 * Listens for OrderCreated events to empty the cart asynchronously (eventual consistency!).
 */
import {
  ApiError, callService, createDb, createService, log, Rabbit, requireAuth, requireInternal, requiredEnv, UpstreamError, validate, z,
} from '@qamart/common';

const db = createDb(requiredEnv('DATABASE_URL'), 'cart_db');
const rabbit = new Rabbit(requiredEnv('RABBITMQ_URL'));
const PRODUCT_URL = requiredEnv('PRODUCT_URL');
const MAX_QTY = 10;
const svc = createService();
const { app } = svc;

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS cart_items (
      user_id    UUID NOT NULL,
      product_id TEXT NOT NULL,
      name       TEXT NOT NULL,
      unit_price INT  NOT NULL CHECK (unit_price > 0),   -- price snapshot when added
      image      JSONB,
      quantity   INT  NOT NULL CHECK (quantity BETWEEN 1 AND ${MAX_QTY}),
      added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, product_id)
    )`);
}

async function loadCart(userId: string) {
  const { rows } = await db.query('SELECT * FROM cart_items WHERE user_id = $1 ORDER BY added_at', [userId]);
  const items = rows.map((r) => ({
    productId: r.product_id, name: r.name, unitPrice: r.unit_price, image: r.image, quantity: r.quantity, lineTotal: r.unit_price * r.quantity,
  }));
  return {
    userId,
    items,
    itemCount: items.reduce((n, i) => n + i.quantity, 0),
    subtotal: items.reduce((n, i) => n + i.lineTotal, 0),
  };
}

app.use('/api/cart', requireAuth);

app.get('/api/cart', async (req, res) => {
  res.json(await loadCart(req.user!.id));
});

const AddItem = z.object({
  productId: z.string().regex(/^[a-z0-9-]{3,60}$/, 'must be a valid product id'),
  quantity: z.number({ message: 'must be a number' }).int('must be a whole number').min(1, 'must be at least 1').max(MAX_QTY, `must be at most ${MAX_QTY}`).default(1),
}).strict();

app.post('/api/cart/items', async (req, res) => {
  const body = validate(AddItem, req.body);
  let product: any;
  try {
    const r = await callService<{ items: any[] }>('product', `${PRODUCT_URL}/internal/products?ids=${body.productId}`, { timeoutMs: 2000 });
    product = r.data.items[0];
  } catch (e) {
    // Partial failure: browsing may still work from cache, but we cannot add an unknown product.
    if (e instanceof UpstreamError) throw new ApiError(503, 'PRODUCT_SERVICE_UNAVAILABLE', 'Cannot add to cart right now: product service unavailable');
    throw e;
  }
  if (!product) throw new ApiError(404, 'PRODUCT_NOT_FOUND', `Product ${body.productId} does not exist`);

  const { rows } = await db.query('SELECT quantity FROM cart_items WHERE user_id = $1 AND product_id = $2', [req.user!.id, body.productId]);
  const newQty = (rows[0]?.quantity ?? 0) + body.quantity;
  if (newQty > MAX_QTY) throw new ApiError(422, 'CART_LIMIT_EXCEEDED', `You can buy at most ${MAX_QTY} of one product`, { productId: body.productId, inCart: rows[0]?.quantity ?? 0 });

  await db.query(
    `INSERT INTO cart_items (user_id, product_id, name, unit_price, image, quantity) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = $6, unit_price = $4, name = $3`,
    [req.user!.id, body.productId, product.name, product.price, JSON.stringify(product.image), newQty],
  );
  log.info('Item added to cart', { productId: body.productId, quantity: newQty });
  res.status(201).json(await loadCart(req.user!.id));
});

const UpdateItem = z.object({
  quantity: z.number({ message: 'must be a number' }).int('must be a whole number').min(1, 'must be at least 1 (use DELETE to remove)').max(MAX_QTY, `must be at most ${MAX_QTY}`),
}).strict();

app.patch('/api/cart/items/:productId', async (req, res) => {
  const body = validate(UpdateItem, req.body);
  const r = await db.query('UPDATE cart_items SET quantity = $3 WHERE user_id = $1 AND product_id = $2', [req.user!.id, req.params.productId, body.quantity]);
  if (r.rowCount === 0) throw new ApiError(404, 'ITEM_NOT_IN_CART', `${req.params.productId} is not in your cart`);
  res.json(await loadCart(req.user!.id));
});

app.delete('/api/cart/items/:productId', async (req, res) => {
  const r = await db.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2', [req.user!.id, req.params.productId]);
  if (r.rowCount === 0) throw new ApiError(404, 'ITEM_NOT_IN_CART', `${req.params.productId} is not in your cart`);
  res.json(await loadCart(req.user!.id));
});

app.delete('/api/cart', async (req, res) => {
  await db.query('DELETE FROM cart_items WHERE user_id = $1', [req.user!.id]);
  res.json(await loadCart(req.user!.id));
});

// ---------------------------------------------------------------- internal API
app.get('/internal/carts/:userId', requireInternal, async (req, res) => {
  res.json(await loadCart(validate(z.string().uuid(), req.params.userId)));
});

// ---------------------------------------------------------------- async: OrderCreated => remove purchased items
rabbit.consume({
  queue: 'cart.order-created',
  bindings: ['order.created'],
  handler: async (event: { userId: string; items: Array<{ productId: string }> }) => {
    // Deleting is naturally idempotent: a duplicate event simply deletes nothing.
    const r = await db.query('DELETE FROM cart_items WHERE user_id = $1 AND product_id = ANY($2)', [event.userId, event.items.map((i) => i.productId)]);
    log.info('Cart cleared after order', { userId: event.userId, removed: r.rowCount });
  },
});

svc.healthCheck('postgres', db.ping);
svc.healthCheck('rabbitmq', () => rabbit.ping(), false);
svc.onLabReset(async () => {
  await db.query('TRUNCATE cart_items');
});

(async () => {
  await db.waitUntilReady();
  await migrate();
  void rabbit.connect();
  await svc.start();
})();
