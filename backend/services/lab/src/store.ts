/**
 * In-memory telemetry store: spans + logs pushed by services, access logs pushed by Nginx.
 * Keeps the most recent traces only (this is a teaching tool, not a production APM).
 */
import type { Response } from 'express';
import type { LogRecord, SpanRecord } from '@qamart/common';

export interface Trace {
  traceId: string;
  spans: SpanRecord[];
  logs: LogRecord[];
  firstSeen: number;
  lastUpdate: number;
}

const MAX_TRACES = 400;
const traces = new Map<string, Trace>();
const recentLogs: LogRecord[] = [];
const clients = new Set<Response>();
const dirty = new Set<string>();

export function broadcast(event: string, data: unknown) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
}

export function addClient(res: Response) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function traceFor(id: string) {
  let t = traces.get(id);
  if (!t) {
    t = { traceId: id, spans: [], logs: [], firstSeen: Date.now(), lastUpdate: Date.now() };
    traces.set(id, t);
    if (traces.size > MAX_TRACES) traces.delete(traces.keys().next().value!);
  }
  t.lastUpdate = Date.now();
  dirty.add(id);
  return t;
}

export function ingestSpans(spans: SpanRecord[]) {
  for (const s of spans) if (s.traceId) traceFor(s.traceId).spans.push(s);
}

export function ingestLogs(logs: LogRecord[]) {
  for (const l of logs) {
    recentLogs.push(l);
    if (l.traceId) traceFor(l.traceId).logs.push(l);
    broadcast('log', l);
  }
  if (recentLogs.length > 3000) recentLogs.splice(0, recentLogs.length - 3000);
}

// Push trace summaries to dashboards at most 4x per second.
setInterval(() => {
  if (!dirty.size) return;
  const ids = [...dirty];
  dirty.clear();
  for (const id of ids) {
    const t = traces.get(id);
    if (t) broadcast('trace', summarize(t));
  }
}, 250);

export function summarize(t: Trace) {
  const spans = t.spans;
  const edge = spans.find((s) => s.service === 'nginx' && s.attributes.server === 'edge');
  const root = edge ?? [...spans].filter((s) => s.kind === 'server').sort((a, b) => a.startTime - b.startTime)[0] ?? spans[0];
  const start = Math.min(...spans.map((s) => s.startTime));
  const end = Math.max(...spans.map((s) => s.startTime + s.durationMs));
  const status = Number(root?.attributes['http.status'] ?? 0) || undefined;
  return {
    traceId: t.traceId,
    name: root ? String(root.attributes['http.route'] ?? root.name) : '(logs only)',
    startTime: Number.isFinite(start) ? start : t.firstSeen,
    durationMs: Number.isFinite(end - start) ? Math.round((end - start) * 10) / 10 : 0,
    httpStatus: status,
    services: [...new Set(spans.map((s) => (s.service === 'product' ? s.instance : s.service)))],
    spanCount: spans.length,
    errorCount: spans.filter((s) => s.status === 'error').length + t.logs.filter((l) => l.level === 'error').length,
    async: spans.some((s) => s.kind === 'consumer'),
  };
}

export function listTraces(filter?: string, limit = 100) {
  const all = [...traces.values()].filter((t) => t.spans.length).map(summarize);
  const f = filter?.toLowerCase();
  return all
    .filter((s) => !f || s.traceId.startsWith(f) || s.name.toLowerCase().includes(f) || s.services.some((x) => x.includes(f)))
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, limit);
}

export function getTrace(id: string) {
  const t = traces.get(id);
  if (!t) return null;
  // Clock-skew correction, as tracing tools do: every container has its own clock, and Nginx logs
  // millisecond, cached-clock times at the END of a request. Causality is the ground truth: a
  // request can't be received before it was sent, and a synchronous callee must answer before its
  // caller got the reply. Walk the tree top-down and shift any span (with its subtree) that breaks
  // this into its caller's window; place Nginx just before the upstream it proxied to.
  const spans = t.spans.map((s) => ({ ...s }));
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const kidsOf = new Map<string, SpanRecord[]>();
  for (const s of spans) {
    if (s.parentId && byId.has(s.parentId)) kidsOf.set(s.parentId, [...(kidsOf.get(s.parentId) ?? []), s]);
  }
  const shift = (s: SpanRecord, d: number) => {
    s.startTime += d;
    for (const k of kidsOf.get(s.spanId) ?? []) shift(k, d);
  };
  // Center a callee in its caller's window when it sticks out of it (the clock gap is unknown).
  const fitInside = (k: SpanRecord, lo: number, hi: number) => {
    if (k.startTime >= lo && k.startTime + k.durationMs <= hi) return;
    shift(k, lo + Math.max(0, (hi - lo - k.durationMs) / 2) - k.startTime);
  };
  const visit = (s: SpanRecord, parent?: SpanRecord) => {
    const kids = kidsOf.get(s.spanId) ?? [];
    if (s.service === 'nginx') {
      let loggedEnd = s.startTime + s.durationMs;
      if (parent) {
        // Proxied by Nginx inside a service's call: the caller's own clock bounds it, so Nginx's
        // coarse logged time is only used for its length. Its upstream must fit in the same window.
        const lo = parent.startTime + 0.1;
        const hi = parent.startTime + parent.durationMs - 0.1;
        for (const k of kids) fitInside(k, lo + 0.1, hi);
        s.startTime = kids.length ? Math.max(lo, Math.min(...kids.map((k) => k.startTime)) - 0.1) : lo;
        loggedEnd = Math.min(hi, s.startTime + s.durationMs);
      } else {
        const start = kids.length ? Math.min(s.startTime, Math.min(...kids.map((k) => k.startTime)) - 0.2) : s.startTime;
        s.startTime = start;
        for (const k of kids) if (k.startTime < start + 0.1) shift(k, start + 0.1 - k.startTime);
      }
      kids.forEach((k) => visit(k, s));
      let end = kids.length ? Math.max(loggedEnd, Math.max(...kids.map((k) => k.startTime + k.durationMs)) + 0.2) : loggedEnd;
      if (parent) end = Math.min(end, parent.startTime + parent.durationMs);
      s.durationMs = Math.max(0, Math.round((end - s.startTime) * 100) / 100);
      return;
    }
    for (const k of kids) {
      const crossesProcess = k.service !== s.service || k.instance !== s.instance;
      if (!crossesProcess || k.service === 'nginx') continue;
      // A synchronous call (client → server) must fit inside the caller; an async consumer only can't start early.
      if (s.kind === 'client' && k.kind === 'server') fitInside(k, s.startTime + 0.1, s.startTime + s.durationMs - 0.1);
      else if (k.startTime < s.startTime) shift(k, s.startTime + 0.1 - k.startTime);
    }
    kids.forEach((k) => visit(k, s));
  };
  for (const s of spans) if (!s.parentId || !byId.has(s.parentId)) visit(s);
  return { summary: summarize(t), spans: spans.sort((a, b) => a.startTime - b.startTime), logs: [...t.logs].sort((a, b) => a.ts.localeCompare(b.ts)) };
}

export function getLogs(filter: { service?: string; level?: string; q?: string; limit?: number }) {
  return recentLogs
    .filter((l) => (!filter.service || l.service === filter.service) && (!filter.level || l.level === filter.level))
    .filter((l) => !filter.q || JSON.stringify(l).toLowerCase().includes(filter.q.toLowerCase()))
    .slice(-(filter.limit ?? 300))
    .reverse();
}

export function allSpans() {
  return [...traces.values()].flatMap((t) => t.spans);
}

export function clearTelemetry() {
  traces.clear();
  recentLogs.length = 0;
  broadcast('cleared', {});
}
