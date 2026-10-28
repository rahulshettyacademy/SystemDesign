import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmtMs, lab, SHOP_URL } from '../api';
import { useLab } from '../store';
import { useTrace } from '../useTrace';
import { hopsFromSpans, Topology } from '../components/Topology';
import { RecentRequests } from '../components/RecentRequests';

const DEMOS = [
  { id: 'search', label: 'Search "iphone"', path: '/demos/search', body: { q: 'iphone' } },
  { id: 'order', label: 'Place order', path: '/demos/place-order', body: {} },
  { id: 'journey', label: 'Full customer journey', path: '/demos/journey', body: {} },
];

export function Architecture() {
  const { health, traces } = useLab();
  const [params, setParams] = useSearchParams();
  const selected = params.get('trace');
  const { detail } = useTrace(selected);
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState<string | null>(null);
  const [demoSteps, setDemoSteps] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'micro' | 'mono'>('micro');
  const navigate = useNavigate();

  const hops = useMemo(() => (detail ? hopsFromSpans(detail.spans) : []), [detail]);
  // collapse consecutive duplicate hops (e.g. many SQL statements) for the step list
  const steps = useMemo(() => hops.filter((h, i) => i === 0 || h.from !== hops[i - 1].from || h.to !== hops[i - 1].to), [hops]);

  useEffect(() => {
    setStep(0);
  }, [selected]);
  useEffect(() => {
    if (!steps.length || step >= steps.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), 420);
    return () => clearTimeout(t);
  }, [step, steps.length]);

  const shown = steps.slice(0, step);
  const activeEdges = new Set(shown.map((h) => `${h.from}>${h.to}`));
  const activeNodes = new Set(shown.flatMap((h) => [h.from, h.to]));
  const current = shown.length ? `${shown[shown.length - 1].from}>${shown[shown.length - 1].to}` : null;
  const t0 = detail ? Math.min(...detail.spans.map((s) => s.startTime)) : 0;

  const select = (id: string) => setParams({ trace: id });
  const runDemo = async (d: (typeof DEMOS)[number]) => {
    setRunning(d.id);
    setError(null);
    try {
      const r = await lab<{ steps: any[] }>('POST', d.path, d.body);
      setDemoSteps(r.steps);
      const last = [...r.steps].reverse().find((s) => s.method !== 'GET' || r.steps.length === 1) ?? r.steps[r.steps.length - 1];
      if (last?.requestId) setTimeout(() => select(last.requestId), 600);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="page arch">
      <div className="page__head">
        <div>
          <h1>Architecture &amp; live request flow</h1>
          <p className="muted">Node colours are live health checks. Select a request to replay the path it really took, built from its spans.</p>
        </div>
        <div className="seg">
          <button className={view === 'micro' ? 'is-on' : ''} onClick={() => setView('micro')}>Microservices (running)</button>
          <button className={view === 'mono' ? 'is-on' : ''} onClick={() => setView('mono')}>Monolith (concept)</button>
        </div>
      </div>
      <div className="arch__grid">
        <section className="panel arch__diagram">
          {view === 'micro' ? (
            <>
              <Topology health={health} activeNodes={selected ? activeNodes : undefined} activeEdges={activeEdges} currentEdge={current} onNodeClick={(id) => navigate(`/health#${id}`)} />
              <div className="legend legend--edges">
                <span><i className="ln ln--sync" /> synchronous HTTP</span>
                <span><i className="ln ln--async" /> asynchronous message</span>
                <span><i className="ln ln--data" /> data access</span>
                <span><i className="dot dot--up" /> UP</span><span><i className="dot dot--degraded" /> DEGRADED</span><span><i className="dot dot--down" /> DOWN</span>
              </div>
            </>
          ) : (
            <Monolith />
          )}
        </section>
        <aside className="arch__side">
          <section className="panel">
            <h3>Trigger a real request</h3>
            <div className="btn-row">
              {DEMOS.map((d) => (
                <button key={d.id} className="btn btn--primary" disabled={!!running} onClick={() => runDemo(d)}>{running === d.id ? 'Running…' : d.label}</button>
              ))}
            </div>
            <p className="muted small">Runs as <code>alice@qamart.test</code> through the public gateway, or use the <a href={SHOP_URL} target="_blank" rel="noreferrer">shop</a> in another window: its requests appear here too.</p>
            {error && <div className="alert alert--error">{error}</div>}
            {demoSteps && (
              <div className="demo-steps">
                {demoSteps.map((s, i) => (
                  <button key={i} className={`demo-step ${selected === s.requestId ? 'is-selected' : ''}`} onClick={() => select(s.requestId)}>
                    <span className={`status status--${Math.floor(s.status / 100)}`}>{s.status}</span>
                    <span>{s.step}</span>
                    <span className="muted small">{s.ms} ms{s.cache ? ` · ${s.cache}` : ''}{s.servedBy ? ` · ${s.servedBy}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          {detail && (
            <section className="panel">
              <div className="panel__head">
                <h3>{detail.summary.name} <span className={`status status--${Math.floor((detail.summary.httpStatus ?? 0) / 100)}`}>{detail.summary.httpStatus}</span></h3>
                <div className="btn-row">
                  <button className="btn btn--sm" onClick={() => setStep(0)}>▶ Replay</button>
                  <button className="btn btn--sm" onClick={() => setStep(steps.length)}>Show all</button>
                  <button className="btn btn--sm" onClick={() => navigate(`/traces/${selected}`)}>Waterfall →</button>
                </div>
              </div>
              <div className="muted small mono">request id {selected}</div>
              <ol className="hops">
                {steps.map((h, i) => (
                  <li key={i} className={i < step ? (i === step - 1 ? 'is-current' : 'is-done') : ''}>
                    <span className="hops__t">+{fmtMs(h.at - t0)}</span>
                    <span className="hops__path"><b>{h.from}</b> → <b>{h.to}</b></span>
                    <span className={`hops__name ${h.span.status === 'error' ? 'red' : ''}`}>{h.span.name}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <section className="panel">
            <h3>Recent requests <span className="muted small">(live)</span></h3>
            <RecentRequests traces={traces} selected={selected} onSelect={select} limit={10} />
          </section>
        </aside>
      </div>
    </div>
  );
}

function Monolith() {
  const modules = ['Auth', 'Catalog', 'Cart', 'Inventory', 'Orders', 'Payments', 'Notifications'];
  return (
    <div className="mono-view">
      <svg viewBox="0 0 1020 560" className="topology">
        <g className="node node--client status--up" transform="translate(20,250)"><rect width="120" height="60" rx="10" className="node__box" /><text x="14" y="36" className="node__label">Browser</text></g>
        <g className="node node--edge status--up" transform="translate(190,240)"><rect width="130" height="80" rx="10" className="node__box" /><text x="65" y="36" textAnchor="middle" className="node__label">Load balancer</text><text x="65" y="56" textAnchor="middle" className="node__sub">copies of ONE app</text></g>
        <path d="M140,280 L190,280" className="edge edge--sync" />
        <rect x="380" y="60" width="330" height="440" rx="16" className="mono-box" />
        <text x="545" y="96" textAnchor="middle" className="node__label">ONE deployable application</text>
        <text x="545" y="116" textAnchor="middle" className="node__sub">single codebase · single process · in-memory function calls</text>
        {modules.map((m, i) => (
          <g key={m} transform={`translate(${410 + (i % 2) * 150},${140 + Math.floor(i / 2) * 82})`}>
            <rect width="130" height="58" rx="8" className="mono-module" />
            <text x="65" y="34" textAnchor="middle" className="node__label">{m}</text>
          </g>
        ))}
        <path d="M320,280 L380,280" className="edge edge--sync" />
        <g className="node node--infra status--up" transform="translate(800,240)"><rect width="170" height="80" rx="10" className="node__box" /><text x="14" y="34" className="node__label">ONE database</text><text x="14" y="54" className="node__sub">all tables, shared schema</text></g>
        <path d="M710,280 L800,280" className="edge edge--data" />
      </svg>
      <div className="compare">
        <div><h4>Monolith</h4><ul><li>One deploy: any change redeploys everything</li><li>A crash in Notifications can take down Checkout</li><li>Simple local calls, one transaction for everything</li><li>Scale the whole app, even if only search is busy</li></ul></div>
        <div><h4>Microservices (this lab)</h4><ul><li>Each service deploys and scales independently (3× product)</li><li>Failures are partial: stop <code>cart</code> and search still works</li><li>Network calls can time out ⇒ retries, idempotency, reconciliation</li><li>Each service owns its data ⇒ eventual consistency via events</li></ul></div>
      </div>
    </div>
  );
}
