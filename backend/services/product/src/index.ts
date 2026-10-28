/**
 * PRODUCT SERVICE — owns the product catalog (MongoDB catalog_db) and its Redis cache.
 * Runs as THREE identical, stateless instances (product-1/2/3) behind the Nginx load balancer.
 * Stock levels are NOT here: they belong to the inventory service.
 */
import { MongoClient } from 'mongodb';
import {
  ApiError, config, createService, log, requireAuth, requireInternal, requireRole, requiredEnv, sleep, validate, withSpan, z,
} from '@qamart/common';
import { CATALOG, CATEGORIES, ProductDoc } from './catalog';
import { cacheAside, cacheSettings, cacheStats, DEFAULT_CACHE_SETTINGS, flushProductKeys, invalidate, redis } from './cache';

const mongo = new MongoClient(requiredEnv('MONGO_URL'), { serverSelectionTimeoutMS: 3000 });
const products = mongo.db('catalog_db').collection<ProductDoc>('products');
const svc = createService();
const { app } = svc;

const mongoOp = <T>(op: string, attrs: Record<string, unknown>, fn: () => Promise<T>) =>
  withSpan(`MongoDB ${op}`, 'db', { 'db.system': 'mongodb', 'db.name': 'catalog_db', collection: 'products', ...attrs }, fn);

const summary = (d: ProductDoc) => ({
  id: d._id, sku: d.sku, name: d.name, brand: d.brand, category: d.category,
  price: effectivePrice(d), mrp: d.mrp, rating: d.rating, reviews: d.reviews, image: d.image,
  sale: d.sale?.active ? { label: d.sale.label, regularPrice: d.price } : null,
});
const effectivePrice = (d: ProductDoc) => (d.sale?.active ? d.sale.price : d.price);
const detail = (d: ProductDoc) => ({
  ...summary(d), description: d.description, specs: d.specs ?? null, variants: d.variants ?? null,
  tags: d.tags, updatedAt: d.updatedAt ?? null,
});

async function seed(force = false) {
  if (!force && (await products.countDocuments()) > 0) return;
  await products.deleteMany({});
  await products.insertMany(CATALOG.map((d) => ({ ...d, updatedAt: new Date('2026-01-01T00:00:00Z') })));
  await products.createIndex({ category: 1 });
  log.info('Seeded product catalog', { count: CATALOG.length });
}

// ---------------------------------------------------------------- public API
const SearchQuery = z.object({
  q: z.string().trim().max(100, 'must be at most 100 characters').optional(),
  category: z.enum(Object.keys(CATEGORIES) as [string, ...string[]], { message: `must be one of: ${Object.keys(CATEGORIES).join(', ')}` }).optional(),
  deals: z.enum(['true', 'false']).optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'rating']).default('relevance'),
  page: z.coerce.number({ message: 'must be a number' }).int().min(1, 'must be >= 1').default(1),
  limit: z.coerce.number({ message: 'must be a number' }).int().min(1, 'must be >= 1').max(50, 'must be <= 50').default(12),
}).strict();

app.get('/api/products', async (req, res) => {
  const query = validate(SearchQuery, req.query);
  const filter: Record<string, unknown> = {};
  if (query.q) {
    const rx = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { brand: rx }, { category: rx }, { tags: rx }];
  }
  if (query.category) filter.category = query.category;
  if (query.deals === 'true') filter['sale.active'] = true;
  const sort: Record<string, 1 | -1> =
    query.sort === 'price_asc' ? { price: 1 } : query.sort === 'price_desc' ? { price: -1 } : query.sort === 'rating' ? { rating: -1 } : { reviews: -1 };

  const [items, total] = await mongoOp('find', { filter: JSON.stringify(filter), sort }, () =>
    Promise.all([
      products.find(filter).sort(sort).skip((query.page - 1) * query.limit).limit(query.limit).toArray(),
      products.countDocuments(filter),
    ]),
  );
  log.info('Product search', { q: query.q, category: query.category, results: total });
  res.json({ items: items.map(summary), page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) });
});

app.get('/api/products/categories', async (_req, res) => {
  const counts = await mongoOp('aggregate', { pipeline: 'group by category' }, () =>
    products.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$category', count: { $sum: 1 } } }]).toArray(),
  );
  res.json({ categories: Object.entries(CATEGORIES).map(([id, name]) => ({ id, name, count: counts.find((c) => c._id === id)?.count ?? 0 })) });
});

app.get('/api/products/sale', async (_req, res) => {
  const n = await mongoOp('countDocuments', { filter: '{"sale.active":true}' }, () => products.countDocuments({ 'sale.active': true }));
  res.json({ active: n > 0, label: 'Diwali Dhamaka Sale', dealCount: n });
});

const ProductId = z.string().regex(/^[a-z0-9-]{3,60}$/, 'must be 3-60 lowercase letters, digits or dashes');

app.get('/api/products/:id', async (req, res) => {
  const id = validate(ProductId, req.params.id, 'id');
  const result = await cacheAside(id, async () => {
    const d = await mongoOp('findOne', { filter: `{"_id":"${id}"}` }, () => products.findOne({ _id: id }));
    return d ? detail(d) : null;
  });
  if (config.labMode) {
    // Development-only diagnostics so students can SEE cache behaviour.
    res.setHeader('X-Cache', result.status);
    if (result.ttl !== undefined) res.setHeader('X-Cache-TTL', String(result.ttl));
  }
  if (!result.value) throw new ApiError(404, 'PRODUCT_NOT_FOUND', `Product ${id} does not exist`);
  res.json(result.value);
});

const PriceUpdate = z.object({
  price: z.number().int('must be a whole number of rupees').positive('must be > 0').max(10_000_000).optional(),
  mrp: z.number().int().positive().max(10_000_000).optional(),
  name: z.string().min(3).max(150).optional(),
}).strict().refine((b) => Object.keys(b).length > 0, 'at least one of price, mrp, name is required');

/** Admin-only catalog update. Shows WRITE + CACHE INVALIDATION. */
app.patch('/api/products/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const id = validate(ProductId, req.params.id, 'id');
  const body = validate(PriceUpdate, req.body);
  const updated = await updateProduct(id, body);
  res.json(updated);
});

async function updateProduct(id: string, body: { price?: number; mrp?: number; name?: string }) {
  const r = await mongoOp('updateOne', { filter: `{"_id":"${id}"}`, update: JSON.stringify(body) }, () =>
    products.findOneAndUpdate({ _id: id }, { $set: { ...body, updatedAt: new Date() } }, { returnDocument: 'after' }),
  );
  if (!r) throw new ApiError(404, 'PRODUCT_NOT_FOUND', `Product ${id} does not exist`);
  let cacheInvalidated = false;
  if (cacheSettings.invalidateOnUpdate) {
    try {
      await invalidate(id);
      cacheInvalidated = true;
    } catch (e) {
      log.warn('Cache invalidation failed', { id, error: (e as Error).message });
    }
  } else {
    log.warn('Cache invalidation is DISABLED: cached copy is now stale until TTL expires', { id });
  }
  log.info('Product updated', { id, changes: body, cacheInvalidated });
  return { product: detail(r), cacheInvalidated };
}

// ---------------------------------------------------------------- internal API (other services)
/** Authoritative read straight from MongoDB (never the cache): used for pricing at checkout. */
app.get('/internal/products', requireInternal, async (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').filter(Boolean).slice(0, 50);
  const docs = await mongoOp('find', { filter: `{"_id":{"$in":${JSON.stringify(ids)}}}`, source: 'database (no cache)' }, () =>
    products.find({ _id: { $in: ids } }).toArray(),
  );
  res.json({ items: docs.map(summary) });
});

// ---------------------------------------------------------------- lab (teaching) hooks
svc.healthCheck('mongodb', () => mongo.db('catalog_db').command({ ping: 1 }));
svc.healthCheck('redis', () => redis.ping(), false); // non-critical: we can serve from MongoDB
svc.setLabInfo(() => ({ cache: { settings: cacheSettings, stats: cacheStats } }));
svc.labAction('cache-settings', (b: Partial<typeof cacheSettings>) => {
  if (typeof b.ttlSeconds === 'number' && b.ttlSeconds >= 1) cacheSettings.ttlSeconds = Math.round(b.ttlSeconds);
  if (typeof b.invalidateOnUpdate === 'boolean') cacheSettings.invalidateOnUpdate = b.invalidateOnUpdate;
  if (typeof b.enabled === 'boolean') cacheSettings.enabled = b.enabled;
  log.warn('Cache settings changed', { ...cacheSettings });
  return { instance: config.instance, settings: cacheSettings };
});
svc.labAction('update-product', (b: { id: string; price?: number; mrp?: number }) => updateProduct(validate(ProductId, b.id), validate(PriceUpdate, { price: b.price, mrp: b.mrp })));
svc.labAction('invalidate', async (b: { id?: string }) => {
  if (b.id) {
    await invalidate(b.id);
    return { invalidated: [b.id] };
  }
  return { invalidated: await flushProductKeys() };
});
svc.labAction('set-sale', async (b: { active: boolean }) => {
  const r = await products.updateMany({ sale: { $exists: true } }, { $set: { 'sale.active': !!b.active, updatedAt: new Date() } });
  const flushed = await flushProductKeys().catch(() => 0);
  log.warn(`Diwali sale ${b.active ? 'STARTED' : 'ENDED'}`, { products: r.modifiedCount, cacheKeysFlushed: flushed });
  const deals = await products.find({ sale: { $exists: true } }).toArray();
  return { active: !!b.active, deals: deals.map((d) => ({ id: d._id, name: d.name, salePrice: d.sale!.price, limitedStock: d.sale!.limitedStock ?? null })) };
});
svc.labAction('reset-stats', () => {
  Object.assign(cacheStats, { hits: 0, misses: 0, bypass: 0, errors: 0, invalidations: 0 });
  return cacheStats;
});
svc.onLabReset(async () => {
  Object.assign(cacheSettings, DEFAULT_CACHE_SETTINGS);
  Object.assign(cacheStats, { hits: 0, misses: 0, bypass: 0, errors: 0, invalidations: 0 });
});
// Only one instance needs to reseed shared data; the lab calls this on product-1.
svc.labAction('reseed', async () => {
  await seed(true);
  const flushed = await flushProductKeys().catch(() => 0);
  return { products: CATALOG.length, cacheKeysFlushed: flushed };
});

(async () => {
  for (;;) {
    try {
      await mongo.connect();
      break;
    } catch (e) {
      log.warn('Waiting for MongoDB...', { error: (e as Error).message });
      await sleep(2000);
    }
  }
  // Seeding from three instances at once is harmless here (deterministic data); only the first wins.
  if (config.instance === 'product-1') await seed();
  await svc.start();
})();
