export async function lab<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/lab/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok && res.status !== 207) throw new Error(data?.error?.message ?? `Lab API ${path} failed (${res.status})`);
  return data as T;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentId?: string;
  service: string;
  instance: string;
  name: string;
  kind: 'server' | 'client' | 'db' | 'cache' | 'producer' | 'consumer' | 'internal';
  startTime: number;
  durationMs: number;
  status: 'ok' | 'error';
  attributes: Record<string, any>;
}
export interface LogRecord {
  ts: string;
  level: string;
  service: string;
  instance: string;
  traceId?: string;
  msg: string;
  [k: string]: unknown;
}
export interface TraceSummary {
  traceId: string;
  name: string;
  startTime: number;
  durationMs: number;
  httpStatus?: number;
  services: string[];
  spanCount: number;
  errorCount: number;
  async: boolean;
}
export interface TraceDetail {
  summary: TraceSummary;
  spans: Span[];
  logs: LogRecord[];
}
export interface Health {
  id: string;
  kind: 'service' | 'infra';
  service: string;
  status: 'UP' | 'DEGRADED' | 'DOWN';
  latencyMs: number | null;
  reason?: string;
  checks?: Record<string, { status: string; latencyMs: number; error?: string }>;
  faults?: Record<string, unknown>;
}
export interface LbRecord {
  ts: number;
  server: string;
  method: string;
  path: string;
  status: number;
  servedBy: string;
  upstreams: string[];
  upstreamStatus: string;
  failover: boolean;
  traceId: string;
  ms: number;
}

export const SHOP_URL = `${location.protocol}//${location.hostname}:8080`;
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { hour12: false }) + '.' + String(Math.floor(ms % 1000)).padStart(3, '0');
export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`);
