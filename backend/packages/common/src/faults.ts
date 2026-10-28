import type { NextFunction, Request, Response } from 'express';
import { config, sleep } from './config';
import { log } from './logger';

export type FaultValue = boolean | number | string;

/**
 * In-memory fault switches for THIS instance only. Set by the lab service through
 * /__lab/faults. Restarting the container clears them.
 *
 * Generic keys understood by every service:
 *   http.latencyMs   number  add delay before handling each API request
 *   http.errorRate   0..1    fraction of API requests answered with 500
 *   http.unavailable boolean answer every request (and /health) with 503
 */
const store = new Map<string, FaultValue>();

export const Faults = {
  get<T extends FaultValue>(key: string, fallback: T): T {
    return (store.has(key) ? store.get(key) : fallback) as T;
  },
  set(values: Record<string, FaultValue | null>) {
    for (const [k, v] of Object.entries(values)) {
      if (v === null || v === false || v === 0 || v === 'off') store.delete(k);
      else store.set(k, v);
    }
    log.warn('Fault configuration changed', { faults: Object.fromEntries(store) });
  },
  clear() {
    if (store.size) log.info('All faults cleared');
    store.clear();
  },
  all(): Record<string, FaultValue> {
    return Object.fromEntries(store);
  },
};

export async function faultMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!config.labMode) return next();
  if (Faults.get('http.unavailable', false)) {
    log.warn('Injected fault: service unavailable', { path: req.path });
    res.status(503).json({
      error: { code: 'SERVICE_UNAVAILABLE', message: `${config.service} is unavailable (injected fault)`, requestId: req.requestId },
    });
    return;
  }
  const latency = Number(Faults.get('http.latencyMs', 0));
  if (latency > 0) {
    log.warn('Injected fault: added latency', { latencyMs: latency });
    await sleep(latency);
  }
  const rate = Number(Faults.get('http.errorRate', 0));
  if (rate > 0 && Math.random() < rate) {
    log.warn('Injected fault: random 500', { errorRate: rate });
    res.status(500).json({
      error: { code: 'INJECTED_FAULT', message: 'Injected random failure', requestId: req.requestId },
    });
    return;
  }
  next();
}
