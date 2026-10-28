/**
 * The architecture map. Node colours come from LIVE health checks; highlighted
 * nodes/edges come from the REAL spans of the selected request (no fake animation).
 */
import { Health, Span } from '../api';

interface NodeDef { id: string; label: string; sub: string; x: number; y: number; w: number; h: number; kind: 'client' | 'edge' | 'service' | 'infra' | 'lb' }

export const NODES: NodeDef[] = [
  { id: 'browser', label: 'Browser', sub: 'React shop', x: 16, y: 285, w: 120, h: 60, kind: 'client' },
  { id: 'nginx', label: 'Nginx', sub: 'gateway + load balancer :8080', x: 186, y: 60, w: 130, h: 510, kind: 'edge' },
  { id: 'auth', label: 'auth', sub: 'login · JWT', x: 380, y: 34, w: 156, h: 46, kind: 'service' },
  { id: 'product-1', label: 'product-1', sub: 'catalog · cache', x: 380, y: 116, w: 156, h: 46, kind: 'service' },
  { id: 'product-2', label: 'product-2', sub: 'catalog · cache', x: 380, y: 172, w: 156, h: 46, kind: 'service' },
  { id: 'product-3', label: 'product-3', sub: 'catalog · cache', x: 380, y: 228, w: 156, h: 46, kind: 'service' },
  { id: 'cart', label: 'cart', sub: 'cart_db', x: 380, y: 318, w: 156, h: 46, kind: 'service' },
  { id: 'inventory', label: 'inventory', sub: 'inventory_db', x: 380, y: 388, w: 156, h: 46, kind: 'service' },
  { id: 'notification', label: 'notification', sub: 'consumer', x: 380, y: 458, w: 156, h: 46, kind: 'service' },
  { id: 'order', label: 'order', sub: 'checkout orchestrator', x: 380, y: 540, w: 156, h: 46, kind: 'service' },
  { id: 'internal-lb', label: 'Internal LB', sub: 'nginx :8090', x: 620, y: 172, w: 140, h: 46, kind: 'lb' },
  { id: 'rabbitmq', label: 'RabbitMQ', sub: 'exchange shop.events', x: 620, y: 420, w: 140, h: 56, kind: 'infra' },
  { id: 'payment', label: 'payment', sub: 'simulated PSP', x: 620, y: 540, w: 140, h: 46, kind: 'service' },
  { id: 'redis', label: 'Redis', sub: 'cache-aside', x: 846, y: 120, w: 160, h: 50, kind: 'infra' },
  { id: 'mongodb', label: 'MongoDB', sub: 'catalog_db · notification_db', x: 846, y: 250, w: 160, h: 56, kind: 'infra' },
  { id: 'postgres', label: 'PostgreSQL', sub: 'auth · cart · inventory · order · payment', x: 846, y: 450, w: 160, h: 70, kind: 'infra' },
];
const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));

type EdgeKind = 'sync' | 'async' | 'data';
const E = (from: string, to: string, kind: EdgeKind = 'sync') => ({ from, to, kind, id: `${from}>${to}` });
export const EDGES = [
  E('browser', 'nginx'),
  ...['auth', 'product-1', 'product-2', 'product-3', 'cart', 'inventory', 'notification', 'order'].map((s) => E('nginx', s)),
  E('nginx', 'payment'),
  E('order', 'cart'), E('order', 'internal-lb'), E('cart', 'internal-lb'), E('order', 'inventory'), E('order', 'payment'),
  E('internal-lb', 'product-1'), E('internal-lb', 'product-2'), E('internal-lb', 'product-3'),
  E('order', 'rabbitmq', 'async'), E('rabbitmq', 'notification', 'async'), E('rabbitmq', 'inventory', 'async'), E('rabbitmq', 'cart', 'async'),
  ...['product-1', 'product-2', 'product-3'].flatMap((p) => [E(p, 'redis', 'data'), E(p, 'mongodb', 'data')]),
  E('notification', 'mongodb', 'data'),
  ...['auth', 'cart', 'inventory', 'order', 'payment'].map((s) => E(s, 'postgres', 'data')),
];

/** Which diagram node a span belongs to. */
export function nodeOfSpan(s: Span): string {
  if (s.service === 'nginx') return s.instance === 'nginx-internal-lb' ? 'internal-lb' : 'nginx';
  if (s.kind === 'db' || s.kind === 'cache') {
    const sys = s.attributes['db.system'];
    if (sys === 'postgresql') return 'postgres';
    if (sys === 'mongodb') return 'mongodb';
    if (sys === 'redis') return 'redis';
  }
  if (s.kind === 'producer') return 'rabbitmq';
  return s.service === 'product' ? s.instance : s.service;
}

const serviceNode = (s: Span) => (s.service === 'product' ? s.instance : s.service);

/** Derive the visited path from real spans: [{from,to,at}] in time order. */
export function hopsFromSpans(spans: Span[]) {
  const byIdSpan = new Map(spans.map((s) => [s.spanId, s]));
  const hops: Array<{ from: string; to: string; at: number; span: Span }> = [];
  for (const s of spans) {
    const node = nodeOfSpan(s);
    if (s.service === 'nginx' && s.instance === 'nginx-edge') {
      hops.push({ from: 'browser', to: 'nginx', at: s.startTime, span: s });
      continue;
    }
    // Database, cache and publish spans are recorded BY the calling service.
    if (s.kind === 'db' || s.kind === 'cache' || s.kind === 'producer') {
      hops.push({ from: serviceNode(s), to: node, at: s.startTime, span: s });
      continue;
    }
    if (s.kind === 'consumer') {
      hops.push({ from: 'rabbitmq', to: node, at: s.startTime, span: s });
      continue;
    }
    const parent = s.parentId ? byIdSpan.get(s.parentId) : undefined;
    if (!parent) continue;
    const from = nodeOfSpan(parent);
    if (from !== node) hops.push({ from, to: node, at: s.startTime, span: s });
  }
  return hops.sort((a, b) => a.at - b.at);
}

function anchor(from: NodeDef, to: NodeDef) {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  if (from.id === 'nginx') {
    const y = Math.min(Math.max(tc.y, from.y + 20), from.y + from.h - 20);
    return { x1: from.x + from.w, y1: y, x2: to.x, y2: tc.y, curve: false };
  }
  if (to.id === 'nginx') return { x1: from.x + from.w, y1: fc.y, x2: to.x, y2: fc.y, curve: false };
  if (Math.abs(fc.x - tc.x) < 10) {
    // same column: curve out to the right
    return { x1: from.x + from.w, y1: fc.y, x2: to.x + to.w, y2: tc.y, curve: true };
  }
  if (tc.x > fc.x) return { x1: from.x + from.w, y1: fc.y, x2: to.x, y2: tc.y, curve: false };
  return { x1: from.x, y1: fc.y, x2: to.x + to.w, y2: tc.y, curve: false };
}

function edgePath(from: NodeDef, to: NodeDef) {
  const a = anchor(from, to);
  if (a.curve) {
    const dx = 40 + Math.abs(a.y2 - a.y1) * 0.12;
    return `M${a.x1},${a.y1} C${a.x1 + dx},${a.y1} ${a.x2 + dx},${a.y2} ${a.x2},${a.y2}`;
  }
  const mx = (a.x1 + a.x2) / 2;
  return `M${a.x1},${a.y1} C${mx},${a.y1} ${mx},${a.y2} ${a.x2},${a.y2}`;
}

export function Topology({ health, activeNodes, activeEdges, currentEdge, onNodeClick }: {
  health: Record<string, Health>;
  activeNodes?: Set<string>;
  activeEdges?: Set<string>;
  currentEdge?: string | null;
  onNodeClick?: (id: string) => void;
}) {
  const highlighting = !!activeNodes && activeNodes.size > 0;
  const statusOf = (id: string) => (id === 'browser' ? 'UP' : id === 'internal-lb' ? health.nginx?.status : health[id]?.status) ?? 'UNKNOWN';
  return (
    <svg className="topology" viewBox="0 0 1020 600" role="img" aria-label="QAMart architecture">
      <defs>
        {['base', 'hot', 'async'].map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className={`arrowhead arrowhead--${k}`} />
          </marker>
        ))}
      </defs>
      <rect x="368" y="104" width="180" height="182" rx="12" className="group" />
      <text x="458" y="298" className="group__label" textAnchor="middle">3 stateless instances (round robin)</text>
      <text x="926" y="96" className="col__label" textAnchor="middle">DATA &amp; CACHE</text>
      <text x="690" y="404" className="col__label" textAnchor="middle">MESSAGING</text>

      {EDGES.map((e) => {
        const from = byId[e.from];
        const to = byId[e.to];
        const hot = activeEdges?.has(e.id);
        const current = currentEdge === e.id;
        return (
          <path
            key={e.id}
            d={edgePath(from, to)}
            className={`edge edge--${e.kind} ${hot ? 'is-hot' : ''} ${current ? 'is-current' : ''} ${highlighting && !hot ? 'is-dim' : ''}`}
            markerEnd={e.kind === 'data' ? undefined : `url(#arrow-${hot ? 'hot' : e.kind === 'async' ? 'async' : 'base'})`}
          />
        );
      })}

      {NODES.map((n) => {
        const st = statusOf(n.id);
        const h = n.id === 'internal-lb' ? health.nginx : health[n.id];
        return (
          <g
            key={n.id}
            className={`node node--${n.kind} status--${String(st).toLowerCase()} ${activeNodes?.has(n.id) ? 'is-hot' : ''} ${highlighting && !activeNodes?.has(n.id) ? 'is-dim' : ''}`}
            transform={`translate(${n.x},${n.y})`}
            onClick={() => onNodeClick?.(n.id)}
          >
            <title>{`${n.label}: ${st}${h?.reason ? ` - ${h.reason}` : ''}`}</title>
            <rect width={n.w} height={n.h} rx="10" className="node__box" />
            <circle cx={n.w - 12} cy={12} r={5} className="node__dot" />
            <text x={n.id === 'nginx' ? n.w / 2 : 12} y={n.id === 'nginx' ? 40 : 20} className="node__label" textAnchor={n.id === 'nginx' ? 'middle' : 'start'}>{n.label}</text>
            {n.id === 'nginx' ? (
              <>
                <text x={n.w / 2} y={60} className="node__sub" textAnchor="middle">API gateway</text>
                <text x={n.w / 2} y={76} className="node__sub" textAnchor="middle">+ load balancer</text>
                <text x={n.w / 2} y={92} className="node__sub" textAnchor="middle">:8080</text>
              </>
            ) : (
              <text x={12} y={36} className="node__sub">{n.sub}</text>
            )}
            {h?.latencyMs != null && n.kind !== 'client' && n.id !== 'nginx' && n.h < 60 && (
              <text x={n.w - 10} y={36} className="node__lat" textAnchor="end">{h.latencyMs}ms</text>
            )}
            {st === 'DOWN' && <text x={n.w / 2} y={n.h + 14} className="node__down" textAnchor="middle">DOWN</text>}
          </g>
        );
      })}
    </svg>
  );
}
