/** Polls every instance's /ready plus each infrastructure component every 2 seconds. */
import { broadcast } from './store';
import { mongo, pg, rabbitApi, redis } from './infra';
import { APP_INSTANCES, instanceUrl } from './topology';

export type Status = 'UP' | 'DEGRADED' | 'DOWN';
export interface ComponentHealth {
  id: string;
  kind: 'service' | 'infra';
  service: string;
  status: Status;
  latencyMs: number | null;
  reason?: string;
  checks?: Record<string, { status: string; latencyMs: number; error?: string }>;
  faults?: Record<string, unknown>;
  checkedAt: number;
}

let snapshot: Record<string, ComponentHealth> = {};
export const getHealth = () => snapshot;

async function timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; ms: number; value?: T; error?: string }> {
  const t = Date.now();
  try {
    const value = await fn();
    return { ok: true, ms: Date.now() - t, value };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: (e as Error).message };
  }
}

async function checkInstance(id: string, service: string): Promise<ComponentHealth> {
  const r = await timed(async () => {
    const res = await fetch(`${instanceUrl(id)}/ready`, { signal: AbortSignal.timeout(2500) });
    return res.json() as Promise<any>;
  });
  const base = { id, kind: 'service' as const, service, latencyMs: r.ok ? r.ms : null, checkedAt: Date.now() };
  if (!r.ok) return { ...base, status: 'DOWN', reason: r.error?.includes('fetch failed') ? 'Not reachable (container stopped?)' : r.error };
  const body = r.value;
  const faults = body.faults && Object.keys(body.faults).length ? body.faults : undefined;
  let status: Status = body.status;
  let reason: string | undefined;
  const failedChecks = Object.entries(body.checks ?? {}).filter(([, c]: any) => c.status !== 'UP').map(([n]) => n);
  if (status === 'DOWN') reason = faults?.['http.unavailable'] ? 'Injected fault: unavailable' : `Dependency down: ${failedChecks.join(', ')}`;
  else if (status === 'DEGRADED') reason = `Degraded dependency: ${failedChecks.join(', ')}`;
  else if (r.ms > 1000) {
    status = 'DEGRADED';
    reason = `Slow health response (${r.ms} ms)`;
  } else if (faults) {
    status = 'DEGRADED';
    reason = `Fault active: ${Object.keys(faults).join(', ')}`;
  }
  return { ...base, status, reason, checks: body.checks, faults };
}

async function checkInfra(id: string, fn: () => Promise<unknown>): Promise<ComponentHealth> {
  const r = await timed(fn);
  return { id, kind: 'infra', service: id, status: r.ok ? 'UP' : 'DOWN', latencyMs: r.ok ? r.ms : null, reason: r.error, checkedAt: Date.now() };
}

async function poll() {
  const results = await Promise.all([
    ...APP_INSTANCES.map((i) => checkInstance(i.id, i.service)),
    checkInfra('nginx', async () => {
      const res = await fetch('http://nginx:8080/nginx-health', { signal: AbortSignal.timeout(1500) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }),
    checkInfra('postgres', () => pg.order_db.query('SELECT 1')),
    checkInfra('mongodb', () => mongo.db('catalog_db').command({ ping: 1 })),
    checkInfra('redis', () => redis.ping()),
    checkInfra('rabbitmq', () => rabbitApi('/overview')),
  ]);
  snapshot = Object.fromEntries(results.map((r) => [r.id, r]));
  broadcast('health', snapshot);
}

let polling = false;
export function startHealthPolling() {
  const tick = () => {
    if (polling) return;
    polling = true;
    poll().finally(() => (polling = false));
  };
  tick();
  setInterval(tick, 2000);
}
