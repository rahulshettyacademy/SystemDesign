/**
 * LAB SERVICE — the Teaching Dashboard's backend (control plane). LOCAL DEVELOPMENT ONLY.
 *  - receives spans/logs from every service and tails Nginx access logs
 *  - polls health, injects faults, stops/starts containers
 *  - runs scripted demos and resets the whole system to a known state
 * It is published on 127.0.0.1:8081 only and refuses to start unless LAB_MODE=true.
 */
import express, { NextFunction, Request, Response } from 'express';
import { config, sleep } from '@qamart/common';
import { cacheKeys, datasetList, runDataset } from './data';
import { duplicateOrder, journey, lbBurst, placeOrder, probeProduct, raceLastItem } from './demos';
import { containerAction, dockerAvailable, listContainers } from './docker';
import { getHealth, startHealthPolling } from './health';
import { labCall, rabbitApi, redis, redriveDlq } from './infra';
import { lbStats, startNginxTail, truncateNginxLog } from './nginxlog';
import { activeScenarios, clearAllFaults, SCENARIOS } from './scenarios';
import { addClient, clearTelemetry, getLogs, getTrace, ingestLogs, ingestSpans, listTraces } from './store';
import { APP_INSTANCES, CONTROLLABLE, instancesOf } from './topology';

if (!config.labMode) {
  console.error('LAB_MODE is not "true": the lab service must never run in production. Exiting.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

class LabError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

app.get('/health', (_req, res) => res.json({ status: 'UP', service: 'lab' }));

// ---------------------------------------------------------------- telemetry ingest (internal network)
app.post('/ingest', (req, res) => {
  if (req.header('x-lab-token') !== config.labToken) throw new LabError(403, 'bad lab token');
  ingestSpans(req.body?.spans ?? []);
  ingestLogs(req.body?.logs ?? []);
  res.status(204).end();
});

const api = express.Router();

api.get('/stream', (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(`event: health\ndata: ${JSON.stringify(getHealth())}\n\n`);
  addClient(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => clearInterval(ping));
});

// ---------------------------------------------------------------- traces & logs
api.get('/traces', (req, res) => res.json({ items: listTraces(req.query.q as string | undefined, Number(req.query.limit ?? 150)) }));
api.get('/traces/:id', (req, res) => {
  const t = getTrace(req.params.id);
  if (!t) throw new LabError(404, 'Trace not found (it may have been evicted or not arrived yet)');
  res.json(t);
});
api.get('/logs', (req, res) =>
  res.json({ items: getLogs({ service: req.query.service as string, level: req.query.level as string, q: req.query.q as string, limit: Number(req.query.limit ?? 300) }) }),
);
api.delete('/telemetry', async (_req, res) => {
  clearTelemetry();
  await truncateNginxLog();
  res.json({ cleared: true });
});

// ---------------------------------------------------------------- health & containers
api.get('/health', (_req, res) => res.json(getHealth()));
api.get('/containers', async (_req, res) => {
  if (!(await dockerAvailable())) throw new LabError(503, 'Docker socket not mounted: use `docker compose stop/start <service>` from a terminal instead');
  res.json({ items: await listContainers() });
});
api.post('/containers/:name/:action', async (req, res) => {
  const action = req.params.action as 'stop' | 'start' | 'restart';
  if (!['stop', 'start', 'restart'].includes(action)) throw new LabError(400, 'action must be stop, start or restart');
  if (!CONTROLLABLE.has(req.params.name)) throw new LabError(403, `${req.params.name} is not on the allow-list`);
  res.json(await containerAction(req.params.name, action));
});

// ---------------------------------------------------------------- faults & scenarios
api.get('/scenarios', (_req, res) =>
  res.json({ items: SCENARIOS.map(({ activate, deactivate, ...s }) => ({ ...s, active: activeScenarios.has(s.id) })) }),
);
api.post('/scenarios/:id/:op', async (req, res) => {
  const s = SCENARIOS.find((x) => x.id === req.params.id);
  if (!s) throw new LabError(404, 'Unknown scenario');
  if (req.params.op === 'activate') {
    await s.activate();
    activeScenarios.add(s.id);
  } else if (req.params.op === 'deactivate') {
    await s.deactivate();
    activeScenarios.delete(s.id);
  } else throw new LabError(400, 'op must be activate or deactivate');
  res.json({ id: s.id, active: activeScenarios.has(s.id) });
});
api.get('/faults', async (_req, res) => {
  const entries = await Promise.all(
    APP_INSTANCES.map(async (i) => {
      try {
        return [i.id, await labCall(i.id, 'GET', '/info', undefined, 1500)];
      } catch (e) {
        return [i.id, { unreachable: true, error: (e as Error).message }];
      }
    }),
  );
  res.json(Object.fromEntries(entries));
});
api.put('/faults/:instance', async (req, res) => {
  if (!APP_INSTANCES.some((i) => i.id === req.params.instance)) throw new LabError(404, 'Unknown instance');
  res.json(await labCall(req.params.instance, 'PUT', '/faults', req.body));
});

// ---------------------------------------------------------------- cache
api.get('/cache', async (_req, res) => {
  const instances = await Promise.all(
    instancesOf('product').map(async (i) => {
      try {
        const info = await labCall(i.id, 'GET', '/info', undefined, 1500);
        return { instance: i.id, ...info.cache };
      } catch {
        return { instance: i.id, unreachable: true };
      }
    }),
  );
  let keys: unknown[] = [];
  let redisUp = true;
  try {
    keys = await cacheKeys();
  } catch {
    redisUp = false;
  }
  res.json({ redisUp, keys, instances });
});
api.post('/cache/settings', async (req, res) => {
  res.json(await Promise.all(instancesOf('product').map((i) => labCall(i.id, 'POST', '/actions/cache-settings', req.body).catch((e) => ({ instance: i.id, error: e.message })))));
});
api.post('/cache/invalidate', async (req, res) => {
  res.json(await labCall('product-1', 'POST', '/actions/invalidate', { id: req.body?.id }));
});
api.get('/cache/probe/:id', async (req, res) => res.json(await probeProduct(req.params.id)));
api.post('/products/:id/price', async (req, res) => {
  const price = Number(req.body?.price);
  if (!Number.isInteger(price) || price <= 0) throw new LabError(400, 'price must be a positive whole number');
  // Any instance can do it (they share MongoDB); the invalidation behaviour is the instance's setting.
  const target = instancesOf('product').find((i) => getHealth()[i.id]?.status !== 'DOWN')?.id ?? 'product-1';
  res.json({ via: target, ...(await labCall(target, 'POST', '/actions/update-product', { id: req.params.id, price })) });
});

// ---------------------------------------------------------------- queues
const QUEUE_BASES = ['notification.order-created', 'inventory.order-created', 'cart.order-created'];
api.get('/queues', async (_req, res) => {
  const [queues, overview, exchanges] = await Promise.all([rabbitApi('/queues/%2F'), rabbitApi('/overview'), rabbitApi('/exchanges/%2F/shop.events/bindings/source')]);
  res.json({
    overview: { messages: overview.queue_totals, rates: overview.message_stats },
    bindings: (exchanges as any[]).map((b) => ({ queue: b.destination, routingKey: b.routing_key })),
    queues: (queues as any[]).map((q) => ({
      name: q.name,
      ready: q.messages_ready ?? 0,
      unacked: q.messages_unacknowledged ?? 0,
      consumers: q.consumers ?? 0,
      publishRate: q.message_stats?.publish_details?.rate ?? 0,
      deliverRate: q.message_stats?.deliver_get_details?.rate ?? 0,
      args: q.arguments,
    })),
  });
});
api.get('/queues/:name/peek', async (req, res) => {
  const msgs = await rabbitApi(`/queues/%2F/${encodeURIComponent(req.params.name)}/get`, {
    method: 'POST',
    body: JSON.stringify({ count: 10, ackmode: 'ack_requeue_true', encoding: 'auto', truncate: 5000 }),
  });
  res.json({
    items: (msgs as any[]).map((m) => ({
      routingKey: m.routing_key, redelivered: m.redelivered, properties: m.properties,
      payload: (() => { try { return JSON.parse(m.payload); } catch { return m.payload; } })(),
    })),
  });
});
api.post('/queues/:name/redrive', async (req, res) => {
  const base = req.params.name.replace(/\.dlq$/, '');
  if (!QUEUE_BASES.includes(base)) throw new LabError(404, 'Unknown queue');
  res.json({ moved: await redriveDlq(base) });
});
api.post('/queues/:name/purge', async (req, res) => {
  await rabbitApi(`/queues/%2F/${encodeURIComponent(req.params.name)}/contents`, { method: 'DELETE' });
  res.json({ purged: req.params.name });
});
api.post('/events/republish', async (req, res) => res.json(await labCall('order', 'POST', '/actions/republish', { orderId: req.body?.orderId })));
api.get('/consumers', async (_req, res) => res.json(await labCall('notification', 'GET', '/info')));

api.post('/inventory/stock', async (req, res) => res.json(await labCall('inventory', 'POST', '/actions/set-stock', { items: req.body?.items ?? [] })));

// ---------------------------------------------------------------- load balancer
api.get('/lb', (_req, res) => res.json(lbStats()));
api.post('/lb/burst', async (req, res) => {
  const count = Math.min(Math.max(Number(req.body?.count ?? 12), 1), 100);
  const path = typeof req.body?.path === 'string' && req.body.path.startsWith('/api/products') ? req.body.path : '/api/products?limit=1';
  res.json(await lbBurst(count, path));
});

// ---------------------------------------------------------------- data inspector
api.get('/data', (_req, res) => res.json({ items: datasetList() }));
api.get('/data/:id', async (req, res) => res.json(await runDataset(req.params.id)));

// ---------------------------------------------------------------- demos
api.post('/demos/journey', async (req, res) => res.json(await journey(req.body ?? {})));
api.post('/demos/place-order', async (req, res) => res.json(await placeOrder(req.body ?? {})));
api.post('/demos/race-last-item', async (req, res) => res.json(await raceLastItem(req.body ?? {})));
api.post('/demos/duplicate-order', async (_req, res) => res.json(await duplicateOrder()));
api.post('/demos/search', async (req, res) => {
  const { edge } = await import('./demos');
  res.json({ steps: [await edge('GET', `/api/products?q=${encodeURIComponent(req.body?.q ?? 'iphone')}`, { step: 'Search' })].map(({ body, ...s }) => ({ ...s, summary: `${body?.total} results` })) });
});

// ---------------------------------------------------------------- Diwali sale mode
let saleActive = false;
api.get('/sale', (_req, res) => res.json({ active: saleActive }));
api.post('/sale', async (req, res) => {
  const active = !!req.body?.active;
  const products = await labCall('product-1', 'POST', '/actions/set-sale', { active });
  let stock: unknown = null;
  if (active) {
    const limited = (products.deals as any[]).filter((d) => d.limitedStock !== null).map((d) => ({ productId: d.id, available: d.limitedStock }));
    stock = await labCall('inventory', 'POST', '/actions/set-stock', { items: limited });
  }
  const coupons = await labCall('order', 'POST', '/actions/set-sale', { active });
  saleActive = active;
  res.json({ active, deals: products.deals, limitedStock: stock, coupons });
});

// ---------------------------------------------------------------- reset to a known state
api.post('/reset', async (_req, res) => {
  const report: Array<{ step: string; ok: boolean; detail?: unknown }> = [];
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      report.push({ step: name, ok: true, detail: await fn() });
    } catch (e) {
      report.push({ step: name, ok: false, detail: (e as Error).message });
    }
  };
  await step('Start any stopped containers', async () => {
    const started: string[] = [];
    for (const c of await listContainers()) {
      if (c.controllable && c.state !== 'running') {
        await containerAction(c.name, 'start');
        started.push(c.name);
      }
    }
    if (started.length) {
      // wait for restarted services to answer /health
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        const h = getHealth();
        if (started.every((c) => h[c.replace('qamart-', '')]?.status && h[c.replace('qamart-', '')].status !== 'DOWN')) break;
        await sleep(1000);
      }
    }
    return started;
  });
  await step('Clear all injected faults', async () => {
    await clearAllFaults();
    activeScenarios.clear();
  });
  await step('Purge all queues', async () => {
    const queues = (await rabbitApi('/queues/%2F')) as any[];
    for (const q of queues) await rabbitApi(`/queues/%2F/${encodeURIComponent(q.name)}/contents`, { method: 'DELETE' });
    return queues.map((q) => q.name);
  });
  for (const i of APP_INSTANCES) await step(`Reset ${i.id}`, () => labCall(i.id, 'POST', '/reset', undefined, 20_000));
  await step('Reseed product catalog + flush cache', () => labCall('product-1', 'POST', '/actions/reseed', undefined, 20_000));
  await step('Flush Redis', () => redis.flushdb());
  await step('Clear traces and logs', async () => {
    clearTelemetry();
    await truncateNginxLog();
  });
  saleActive = false;
  const ok = report.every((r) => r.ok);
  res.status(ok ? 200 : 207).json({ ok, report });
});

app.use('/lab/api', api);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof LabError ? err.status : 500;
  res.status(status).json({ error: { message: err?.message ?? 'Lab error' } });
});

startNginxTail();
startHealthPolling();
app.listen(config.port, () => console.log(JSON.stringify({ msg: 'lab service listening', port: config.port })));
