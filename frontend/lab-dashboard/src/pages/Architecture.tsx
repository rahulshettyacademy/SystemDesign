import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { fmtMs, lab, SHOP_URL, Span } from '../api';
import { explainHop } from '../explain';
import { useLab } from '../store';
import { useTrace } from '../useTrace';
import { hopsFromSpans, Topology } from '../components/Topology';
import { RecentRequests } from '../components/RecentRequests';

const DEMOS = [
  { id: 'search', label: 'Search "iphone"', path: '/demos/search', body: { q: 'iphone' } },
  { id: 'order', label: 'Place order', path: '/demos/place-order', body: {} },
  { id: 'journey', label: 'Full customer journey', path: '/demos/journey', body: {} },
];

const SPEEDS = { slow: 1500, normal: 800, fast: 420 } as const;
type Speed = keyof typeof SPEEDS;

// Per-viewer conveniences only: the page works the same when storage is unavailable.
const readStore = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const writeStore = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } };

export function Architecture() {
  const { health, traces } = useLab();
  const [params, setParams] = useSearchParams();
  const selected = params.get('trace');
  const { detail } = useTrace(selected);
  const [step, setStep] = useState(0);
  const [stepMode, setStepMode] = useState(() => readStore('arch.stepMode') === '1');
  const [playing, setPlaying] = useState(!stepMode);
  const [speed, setSpeed] = useState<Speed>(() => (readStore('arch.speed') as Speed) || 'normal');
  const [running, setRunning] = useState<string | null>(null);
  const [demoSteps, setDemoSteps] = useState<any[] | null>(() => {
    try { return JSON.parse(readStore('arch.demoSteps') ?? 'null'); } catch { return null; }
  });
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'micro' | 'mono'>('micro');
  const navigate = useNavigate();
  const currentRef = useRef<HTMLLIElement>(null);

  const hops = useMemo(() => (detail ? hopsFromSpans(detail.spans) : []), [detail]);
  // collapse consecutive duplicate hops (e.g. many SQL statements) into one step, keeping every span
  const steps = useMemo(() => {
    const out: Array<(typeof hops)[number] & { group: Span[] }> = [];
    for (const h of hops) {
      const last = out[out.length - 1];
      if (last && last.from === h.from && last.to === h.to) last.group.push(h.span);
      else out.push({ ...h, group: [h.span] });
    }
    return out;
  }, [hops]);

  // The moment the gateway answered the browser: every hop after it ran asynchronously.
  const responseAt = useMemo(() => {
    const edge = detail?.spans.find((s) => s.service === 'nginx' && s.instance === 'nginx-edge');
    return edge ? edge.startTime + edge.durationMs : null;
  }, [detail]);
  const isAsync = (h: (typeof steps)[number]) =>
    h.span.kind === 'consumer' || h.span.kind === 'producer' || (responseAt !== null && h.at > responseAt);
  const firstAsync = steps.findIndex(isAsync);

  useEffect(() => {
    setStep(0);
    setPlaying(!stepMode);
  }, [selected]);
  useEffect(() => {
    if (!playing || !steps.length || step >= steps.length) return;
    const t = setTimeout(() => setStep((s) => s + 1), SPEEDS[speed]);
    return () => clearTimeout(t);
  }, [playing, step, steps.length, speed]);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [step]);
  useEffect(() => writeStore('arch.stepMode', stepMode ? '1' : '0'), [stepMode]);
  useEffect(() => writeStore('arch.speed', speed), [speed]);
  useEffect(() => { if (demoSteps) writeStore('arch.demoSteps', JSON.stringify(demoSteps)); }, [demoSteps]);

  const shown = steps.slice(0, step);
  const activeEdges = new Set(shown.map((h) => `${h.from}>${h.to}`));
  const activeNodes = new Set(shown.flatMap((h) => [h.from, h.to]));
  const current = shown.length ? `${shown[shown.length - 1].from}>${shown[shown.length - 1].to}` : null;
  const t0 = detail ? Math.min(...detail.spans.map((s) => s.startTime)) : 0;
  const now = step > 0 ? steps[step - 1] : null;
  const explain = (h: (typeof steps)[number]) => explainHop(h, isAsync(h), detail?.summary.name ?? '');
  const nowInfo = now ? explain(now) : null;

  const select = (id: string) => setParams({ trace: id });
  const demoIndex = demoSteps?.findIndex((s) => s.requestId === selected) ?? -1;
  const nextRequest = demoSteps && demoIndex >= 0 && demoIndex < demoSteps.length - 1 ? demoSteps[demoIndex + 1] : null;

  const goTo = (n: number) => {
    setPlaying(false);
    setStep(Math.max(0, Math.min(steps.length, n)));
  };
  const next = () => {
    if (step < steps.length) goTo(step + 1);
    else if (nextRequest?.requestId) select(nextRequest.requestId); // end of this request: move on through the journey
  };
  const togglePlay = () => {
    if (step >= steps.length) setStep(0);
    setPlaying((p) => !(p && step < steps.length));
  };

  // Presenter keys: → next hop, ← previous hop, space play/pause.
  const keys = useRef({ next, togglePlay, prev: () => goTo(step - 1) });
  keys.current = { next, togglePlay, prev: () => goTo(step - 1) };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') keys.current.next();
      else if (e.key === 'ArrowLeft') keys.current.prev();
      else if (e.key === ' ') keys.current.togglePlay();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
              <>
                <div className="muted small demo-steps__hint">Requests from the last run. Click one to replay its path.</div>
                <div className="demo-steps">
                  {demoSteps.map((s, i) => (
                    <button key={i} className={`demo-step ${selected === s.requestId ? 'is-selected' : ''}`} onClick={() => select(s.requestId)}>
                      <span className={`status status--${Math.floor(s.status / 100)}`}>{s.status}</span>
                      <span>{/^\d/.test(s.step) ? s.step : `${i + 1}. ${s.step}`}</span>
                      <span className="muted small">{s.ms} ms{s.cache ? ` · ${s.cache}` : ''}{s.servedBy ? ` · ${s.servedBy}` : ''}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>
          {detail && (
            <section className="panel">
              <div className="panel__head">
                <h3>{detail.summary.name} <span className={`status status--${Math.floor((detail.summary.httpStatus ?? 0) / 100)}`}>{detail.summary.httpStatus}</span></h3>
                <button className="btn btn--sm" onClick={() => navigate(`/traces/${selected}`)}>Waterfall →</button>
              </div>
              <div className="muted small mono">request id {selected}</div>

              <div className="player">
                <div className="seg">
                  <button className={!stepMode ? 'is-on' : ''} onClick={() => { setStepMode(false); setStep(0); setPlaying(true); }}>Auto-play</button>
                  <button className={stepMode ? 'is-on' : ''} onClick={() => { setStepMode(true); goTo(0); }}>Step by step</button>
                </div>
                <label className="player__speed muted small">
                  Speed{' '}
                  <select value={speed} onChange={(e) => setSpeed(e.target.value as Speed)}>
                    <option value="slow">Slow</option>
                    <option value="normal">Normal</option>
                    <option value="fast">Fast</option>
                  </select>
                </label>
              </div>
              <div className="btn-row player__controls">
                <button className="btn btn--sm" onClick={() => goTo(0)} title="Back to the start">⏮</button>
                <button className="btn btn--sm" onClick={() => goTo(step - 1)} disabled={step === 0} title="Previous hop (←)">◀ Prev</button>
                <button className="btn btn--sm btn--primary" onClick={togglePlay} title="Play / pause (space)">{playing && step < steps.length ? '⏸ Pause' : '▶ Play'}</button>
                <button className="btn btn--sm" onClick={next} disabled={step >= steps.length && !nextRequest} title="Next hop (→)">
                  {step >= steps.length && nextRequest ? 'Next request ▶' : 'Next ▶'}
                </button>
                <button className="btn btn--sm" onClick={() => goTo(steps.length)} title="Highlight the whole path">Show all</button>
              </div>

              <div className={`hop-now ${now && isAsync(now) ? 'hop-now--async' : ''}`}>
                {now && nowInfo ? (
                  <>
                    <div className="hop-now__count">
                      Step {step} of {steps.length}
                      <span className={`badge ${isAsync(now) ? 'badge--async' : 'badge--sync'}`}>{isAsync(now) ? 'async (after the response)' : 'sync (browser waiting)'}</span>
                    </div>
                    <div className="hop-now__path"><b>{now.from}</b> → <b>{now.to}</b></div>
                    <div className="hop-now__title">{nowInfo.title}</div>
                    <div className={`hop-now__name ${now.span.status === 'error' ? 'red' : ''}`}>{now.span.name}{now.group.length > 1 ? ` (+${now.group.length - 1} more)` : ''} · +{fmtMs(now.at - t0)}</div>
                  </>
                ) : (
                  <div className="muted small">{steps.length} hops recorded. Press <b>Next</b> (or →) to walk through them, or <b>Play</b> (space).</div>
                )}
              </div>

              <ol className="hops">
                {steps.map((h, i) => [
                  i === firstAsync && (
                    <li key={`divider-${i}`} className="hops__divider">
                      ↩ Response sent to the browser{responseAt !== null ? ` at +${fmtMs(responseAt - t0)}` : ''}. Everything below ran asynchronously.
                    </li>
                  ),
                  <li
                    key={i}
                    ref={i === step - 1 ? currentRef : undefined}
                    className={`${i < step ? (i === step - 1 ? 'is-current' : 'is-done') : ''} ${isAsync(h) ? 'is-async' : ''}`}
                    onClick={() => goTo(i + 1)}
                    title="Jump to this hop"
                  >
                    <span className="hops__t">{i + 1}. +{fmtMs(h.at - t0)}</span>
                    <span className="hops__path"><b>{h.from}</b> → <b>{h.to}</b></span>
                    <span className={`hops__name ${h.span.status === 'error' ? 'red' : ''}`}>{h.span.name}</span>
                    {i === step - 1 && nowInfo && (
                      <div className="hops__why">
                        <div className="hops__why-title">Why? {nowInfo.title}</div>
                        <p>{nowInfo.why}</p>
                        {h.group.length > 1 && (
                          <div className="hops__calls">Includes: {h.group.map((s) => s.name.replace(/^SQL /, '')).join(' · ')}</div>
                        )}
                        <div className="hops__concepts">{nowInfo.concepts.map((c) => <span key={c} className="chip">{c}</span>)}</div>
                      </div>
                    )}
                  </li>,
                ])}
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
