/**
 * Tails Nginx's JSON access log (shared Docker volume) and turns each line into a span,
 * so the dashboard shows the load balancer hop and WHICH instance served each request.
 */
import { promises as dns } from 'node:dns';
import { promises as fs } from 'node:fs';
import type { SpanRecord } from '@qamart/common';
import { broadcast, ingestSpans } from './store';
import { APP_INSTANCES } from './topology';

const LOG_PATH = process.env.NGINX_LOG_PATH ?? '/var/log/nginx/lab/access.json';

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
const lbRecords: LbRecord[] = [];
const ipToName = new Map<string, string>();

async function refreshDns() {
  for (const i of APP_INSTANCES) {
    try {
      const { address } = await dns.lookup(i.id);
      ipToName.set(address, i.id);
    } catch {
      /* stopped container: keep last known mapping */
    }
  }
}

const nameOf = (addr: string) => {
  const ip = addr.trim().split(':')[0];
  return ipToName.get(ip) ?? addr.trim();
};

function toSpan(r: Record<string, string>): SpanRecord | null {
  if (!r.trace_id || !r.uri) return null;
  const end = parseFloat(r.ts) * 1000;
  const dur = parseFloat(r.request_time || '0') * 1000;
  const path = r.uri.split('?')[0];
  const upstreams = r.upstream_addr ? r.upstream_addr.split(',').map(nameOf) : [];
  const status = Number(r.status);
  const failover = (r.upstream_status ?? '').includes(',');
  const isProduct = path.startsWith('/api/products') || path.startsWith('/internal/products');
  if (isProduct) {
    const rec: LbRecord = {
      ts: end, server: r.server, method: r.method, path: r.uri, status, servedBy: r.served_by || upstreams[upstreams.length - 1] || '-',
      upstreams, upstreamStatus: r.upstream_status, failover, traceId: r.trace_id, ms: Math.round(dur),
    };
    lbRecords.push(rec);
    if (lbRecords.length > 2000) lbRecords.splice(0, lbRecords.length - 2000);
    broadcast('lb', rec);
  }
  return {
    traceId: r.trace_id,
    spanId: r.span_id,
    parentId: r.server === 'internal-lb' ? r.parent_span_id || undefined : undefined,
    service: 'nginx',
    instance: r.server === 'edge' ? 'nginx-edge' : 'nginx-internal-lb',
    name: `${r.server === 'edge' ? 'Nginx' : 'Nginx internal LB'} ${r.method} ${path}`,
    kind: r.server === 'edge' ? 'server' : 'client',
    startTime: end - dur,
    durationMs: Math.round(dur * 100) / 100,
    status: status >= 500 ? 'error' : 'ok',
    attributes: {
      server: r.server,
      'http.route': `${r.method} ${path}`,
      'http.target': r.uri,
      'http.status': status,
      'lb.upstreams': upstreams.join(' -> '),
      'lb.upstreamStatus': r.upstream_status,
      'lb.servedBy': r.served_by || undefined,
      'lb.failover': failover || undefined,
      'upstream.ms': r.upstream_time ? Math.round(parseFloat(r.upstream_time) * 1000) : undefined,
    },
  };
}

export function startNginxTail() {
  let offset = -1;
  let partial = '';
  void refreshDns();
  setInterval(() => void refreshDns(), 5000);
  setInterval(async () => {
    try {
      const st = await fs.stat(LOG_PATH);
      if (offset < 0 || st.size < offset) offset = offset < 0 ? st.size : 0; // start at the end; handle truncation
      if (st.size === offset) return;
      const len = Math.min(st.size - offset, 5 * 1024 * 1024);
      const fh = await fs.open(LOG_PATH, 'r');
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      await fh.close();
      offset += len;
      const lines = (partial + buf.toString('utf8')).split('\n');
      partial = lines.pop() ?? '';
      const spans: SpanRecord[] = [];
      for (const line of lines) {
        try {
          const s = toSpan(JSON.parse(line));
          if (s) spans.push(s);
        } catch {
          /* ignore malformed lines */
        }
      }
      ingestSpans(spans);
    } catch {
      /* log file not there yet */
    }
  }, 250);
}

export async function truncateNginxLog() {
  await fs.truncate(LOG_PATH, 0).catch(() => undefined);
  lbRecords.length = 0;
}

export function lbStats(windowMs = 5 * 60_000) {
  const since = Date.now() - windowMs;
  const recent = lbRecords.filter((r) => r.ts >= since);
  const byInstance: Record<string, number> = {};
  for (const r of recent) byInstance[r.servedBy] = (byInstance[r.servedBy] ?? 0) + 1;
  return {
    windowSeconds: windowMs / 1000,
    total: recent.length,
    byInstance,
    failovers: recent.filter((r) => r.failover).length,
    errors: recent.filter((r) => r.status >= 500).length,
    recent: recent.slice(-60).reverse(),
  };
}
