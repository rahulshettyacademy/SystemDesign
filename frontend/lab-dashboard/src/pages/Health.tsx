import { useEffect, useState } from 'react';
import { Health, lab } from '../api';
import { useLab } from '../store';

interface Container { name: string; state: string; status: string; controllable: boolean }

export function HealthPage() {
  const { health } = useLab();
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [dockerError, setDockerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadContainers = () => lab<{ items: Container[] }>('GET', '/containers').then((r) => { setContainers(r.items); setDockerError(null); }).catch((e) => setDockerError(e.message));
  useEffect(() => {
    void loadContainers();
    const t = setInterval(loadContainers, 3000);
    return () => clearInterval(t);
  }, []);

  const act = async (name: string, action: string) => {
    setBusy(name);
    try {
      await lab('POST', `/containers/${name}/${action}`);
      await loadContainers();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const list = Object.values(health);
  const services = list.filter((h) => h.kind === 'service');
  const infra = list.filter((h) => h.kind === 'infra');
  const containerOf = (id: string) => containers?.find((c) => c.name === `qamart-${id}`);
  const counts = { UP: list.filter((h) => h.status === 'UP').length, DEGRADED: list.filter((h) => h.status === 'DEGRADED').length, DOWN: list.filter((h) => h.status === 'DOWN').length };

  const card = (h: Health) => {
    const c = containerOf(h.id);
    return (
      <div key={h.id} id={h.id} className={`hcard status--${h.status.toLowerCase()}`}>
        <div className="hcard__head">
          <span className="dot" />
          <strong>{h.id}</strong>
          <span className={`badge badge--${h.status.toLowerCase()}`}>{h.status}</span>
        </div>
        <div className="hcard__meta">{h.latencyMs != null ? `${h.latencyMs} ms` : 'no response'}{c ? ` · container ${c.state}` : ''}</div>
        {h.reason && <div className="hcard__reason">{h.reason}</div>}
        {h.checks && (
          <div className="checks">
            {Object.entries(h.checks).map(([k, v]) => (
              <span key={k} className={`check check--${v.status.toLowerCase()}`} title={v.error}>{k} {v.status === 'UP' ? `${v.latencyMs}ms` : '✕'}</span>
            ))}
          </div>
        )}
        {h.faults && <div className="checks">{Object.entries(h.faults).map(([k, v]) => <span key={k} className="check check--fault">{k}={String(v)}</span>)}</div>}
        {c?.controllable && (
          <div className="btn-row">
            {c.state === 'running' ? (
              <button className="btn btn--sm btn--danger" disabled={busy === c.name} onClick={() => act(c.name, 'stop')}>Stop container</button>
            ) : (
              <button className="btn btn--sm btn--primary" disabled={busy === c.name} onClick={() => act(c.name, 'start')}>Start container</button>
            )}
            <button className="btn btn--sm" disabled={busy === c.name || c.state !== 'running'} onClick={() => act(c.name, 'restart')}>Restart</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Service health</h1>
          <p className="muted">Polled every 2 s. <b>UP</b> = <code>/ready</code> passes. <b>DEGRADED</b> = a non-critical dependency is down, a fault is injected or the check is slow (&gt;1 s). <b>DOWN</b> = no answer or a critical dependency failed.</p>
        </div>
        <div className="kpis">
          <div className="green"><b>{counts.UP}</b><span>up</span></div>
          <div className="amber"><b>{counts.DEGRADED}</b><span>degraded</span></div>
          <div className="red"><b>{counts.DOWN}</b><span>down</span></div>
        </div>
      </div>
      {dockerError && <div className="alert alert--warn">Container controls unavailable: {dockerError}</div>}
      <h2>Application services</h2>
      <div className="hgrid">{services.map(card)}</div>
      <h2>Infrastructure</h2>
      <div className="hgrid">{infra.map(card)}</div>
    </div>
  );
}
