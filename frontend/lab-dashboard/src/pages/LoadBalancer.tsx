import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtTime, lab } from '../api';
import { useLab } from '../store';

const INSTANCES = ['product-1', 'product-2', 'product-3'];
const COLORS: Record<string, string> = { 'product-1': '#38bdf8', 'product-2': '#a78bfa', 'product-3': '#34d399' };

export function LoadBalancer() {
  const { lb, health } = useLab();
  const navigate = useNavigate();
  const [count, setCount] = useState(30);
  const [path, setPath] = useState('/api/products?limit=1');
  const [burst, setBurst] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [containers, setContainers] = useState<Record<string, string>>({});

  const loadContainers = () =>
    lab<{ items: Array<{ name: string; state: string }> }>('GET', '/containers')
      .then((r) => setContainers(Object.fromEntries(r.items.map((c) => [c.name.replace('qamart-', ''), c.state]))))
      .catch(() => undefined);
  useEffect(() => {
    void loadContainers();
    const t = setInterval(loadContainers, 3000);
    return () => clearInterval(t);
  }, []);

  const run = async () => {
    setBusy('burst');
    try {
      setBurst(await lab('POST', '/lb/burst', { count, path }));
    } finally {
      setBusy(null);
    }
  };
  const act = async (id: string, action: string) => {
    setBusy(id);
    try {
      await lab('POST', `/containers/qamart-${id}/${action}`);
      await loadContainers();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const since = Date.now() - 60_000;
  const recent = lb.filter((r) => r.ts >= since);
  const dist = Object.fromEntries(INSTANCES.map((i) => [i, recent.filter((r) => r.servedBy === i).length]));
  const max = Math.max(1, ...Object.values(dist));
  const failovers = recent.filter((r) => r.failover).length;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Load balancing</h1>
          <p className="muted">Nginx spreads <code>/api/products</code> across three identical instances (round robin). Every response carries <code>X-Served-By</code>. Stop an instance and watch traffic fail over; start it again and it rejoins.</p>
        </div>
      </div>
      <div className="lb-grid">
        {INSTANCES.map((id) => {
          const h = health[id];
          const state = containers[id];
          return (
            <div key={id} className={`panel lb-inst status--${(h?.status ?? 'unknown').toLowerCase()}`}>
              <div className="lb-inst__head">
                <span className="swatch" style={{ background: COLORS[id] }} />
                <strong>{id}</strong>
                <span className={`badge badge--${(h?.status ?? 'unknown').toLowerCase()}`}>{h?.status ?? '…'}</span>
              </div>
              <div className="lb-bar"><div style={{ width: `${(dist[id] / max) * 100}%`, background: COLORS[id] }} /></div>
              <div className="lb-inst__count"><b>{dist[id]}</b> requests in the last 60 s</div>
              {h?.reason && <div className="small amber">{h.reason}</div>}
              <div className="btn-row">
                {state === 'running' ? (
                  <button className="btn btn--sm btn--danger" disabled={busy === id} onClick={() => act(id, 'stop')}>Stop instance</button>
                ) : (
                  <button className="btn btn--sm btn--primary" disabled={busy === id} onClick={() => act(id, 'start')}>Start instance</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <section className="panel">
        <div className="form-row">
          <label>Requests <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
          <label className="grow">Path <input value={path} onChange={(e) => setPath(e.target.value)} /></label>
          <button className="btn btn--primary" onClick={run} disabled={busy === 'burst'}>{busy === 'burst' ? 'Sending…' : 'Send burst through Nginx'}</button>
        </div>
        {burst && (
          <>
            <div className="strip">
              {burst.results.map((r: any) => (
                <span key={r.i} className={`strip__cell ${r.status >= 400 || r.status === 0 ? 'is-fail' : ''} ${r.ms > 500 ? 'is-slow' : ''}`} style={{ background: COLORS[r.servedBy] ?? '#ef4444' }} title={`#${r.i} ${r.servedBy ?? 'FAILED'} ${r.status} ${r.ms}ms`} onClick={() => r.requestId && navigate(`/traces/${r.requestId}`)}>
                  {r.ms > 500 ? '🐢' : ''}
                </span>
              ))}
            </div>
            <div className="small">
              Distribution: {Object.entries(burst.distribution).map(([k, v]) => <span key={k} className="tag">{k}: {String(v)}</span>)}
              {' '}· slowest {Math.max(...burst.results.map((r: any) => r.ms))} ms
            </div>
          </>
        )}
      </section>
      <section className="panel">
        <h3>Nginx access log (product routes) {failovers > 0 && <span className="tag tag--warn">{failovers} failover(s) in last 60 s</span>}</h3>
        <table className="table table--compact">
          <thead><tr><th>Time</th><th>Listener</th><th>Request</th><th>Status</th><th>Upstream tried</th><th>Upstream status</th><th>Served by</th><th>ms</th></tr></thead>
          <tbody>
            {lb.slice(0, 40).map((r, i) => (
              <tr key={i} className={`clickable ${r.failover ? 'is-warn' : ''}`} onClick={() => navigate(`/traces/${r.traceId}`)}>
                <td className="mono small">{fmtTime(r.ts)}</td>
                <td className="small">{r.server}</td>
                <td className="mono small ellipsis">{r.method} {r.path}</td>
                <td><span className={`status status--${Math.floor(r.status / 100)}`}>{r.status}</span></td>
                <td className="mono small">{r.upstreams.join(' → ')}</td>
                <td className="mono small">{r.upstreamStatus}</td>
                <td className="mono small" style={{ color: COLORS[r.servedBy] }}>{r.servedBy}</td>
                <td className="mono small">{r.ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
