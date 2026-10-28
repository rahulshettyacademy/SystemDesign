import { useEffect, useState } from 'react';
import { lab } from '../api';

interface Scenario { id: string; title: string; concept: string; mechanism: string; expected: string; observe: string[]; active: boolean }
const INSTANCES = ['auth', 'product-1', 'product-2', 'product-3', 'cart', 'inventory', 'order', 'payment', 'notification'];

export function Failures() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<any>(null);
  const load = () => lab<{ items: Scenario[] }>('GET', '/scenarios').then((r) => setScenarios(r.items));
  useEffect(() => void load(), []);

  const toggle = async (s: Scenario) => {
    setBusy(s.id);
    setError(null);
    try {
      await lab('POST', `/scenarios/${s.id}/${s.active ? 'deactivate' : 'activate'}`);
      await load();
    } catch (e) {
      setError(`${s.title}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const reset = async () => {
    if (!confirm('Reset EVERYTHING to the known starting state? (restarts stopped containers, clears faults, purges queues, re-seeds all data)')) return;
    setBusy('reset');
    setReport(null);
    try {
      setReport(await lab('POST', '/reset'));
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const concepts = [...new Set(scenarios.map((s) => s.concept))];
  const activeCount = scenarios.filter((s) => s.active).length;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Failure lab <span className="tag tag--warn">instructor only · local</span></h1>
          <p className="muted">Every switch changes REAL behaviour: it stops a container or flips a fault flag inside a running service. Activate, perform the action in the shop, then observe traces, logs, queues and data.</p>
        </div>
        <button className="btn btn--danger btn--lg" onClick={reset} disabled={busy === 'reset'}>{busy === 'reset' ? 'Resetting…' : '⟲ Reset lab to known state'}</button>
      </div>
      {activeCount > 0 && <div className="alert alert--warn">{activeCount} scenario(s) active. Remember to deactivate or reset before the next demo.</div>}
      {error && <div className="alert alert--error">{error}</div>}
      {report && (
        <div className={`alert ${report.ok ? 'alert--success' : 'alert--warn'}`}>
          <strong>{report.ok ? 'Lab reset complete.' : 'Reset finished with warnings.'}</strong>
          <ul className="report">{report.report.map((r: any) => <li key={r.step} className={r.ok ? '' : 'red'}>{r.ok ? '✓' : '✕'} {r.step}{!r.ok && `: ${r.detail}`}</li>)}</ul>
        </div>
      )}
      {concepts.map((c) => (
        <section key={c}>
          <h2>{c}</h2>
          <div className="scen-grid">
            {scenarios.filter((s) => s.concept === c).map((s) => (
              <div key={s.id} className={`scen ${s.active ? 'is-active' : ''}`}>
                <div className="scen__head">
                  <strong>{s.title}</strong>
                  <button className={`switch ${s.active ? 'is-on' : ''}`} disabled={busy === s.id} onClick={() => toggle(s)} aria-label={`toggle ${s.title}`}>
                    <span />
                  </button>
                </div>
                <div className="scen__mech mono">{s.mechanism}</div>
                <p><b>Expected:</b> {s.expected}</p>
                <ul>{s.observe.map((o) => <li key={o}>{o}</li>)}</ul>
                {busy === s.id && <div className="muted small">Applying… (container changes can take a few seconds)</div>}
              </div>
            ))}
          </div>
        </section>
      ))}
      <ManualFaults />
    </div>
  );
}

function ManualFaults() {
  const [inst, setInst] = useState('product-2');
  const [latency, setLatency] = useState(0);
  const [rate, setRate] = useState(0);
  const [down, setDown] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const apply = async () => {
    try {
      const r = await lab('PUT', `/faults/${inst}`, { 'http.latencyMs': latency || null, 'http.errorRate': rate || null, 'http.unavailable': down || null });
      setMsg(`${inst} faults now: ${JSON.stringify(r.faults)}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <section className="panel">
      <h2>Manual fault injection (per instance)</h2>
      <div className="form-row">
        <label>Instance <select value={inst} onChange={(e) => setInst(e.target.value)}>{INSTANCES.map((i) => <option key={i}>{i}</option>)}</select></label>
        <label>Added latency (ms) <input type="number" min={0} step={250} value={latency} onChange={(e) => setLatency(Number(e.target.value))} /></label>
        <label>Error rate (0-1) <input type="number" min={0} max={1} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} /></label>
        <label className="checkbox"><input type="checkbox" checked={down} onChange={(e) => setDown(e.target.checked)} /> Answer 503 (unavailable)</label>
        <button className="btn btn--primary" onClick={apply}>Apply</button>
      </div>
      {msg && <div className="muted small mono">{msg}</div>}
    </section>
  );
}
