import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fmtMs, fmtTime, lab } from '../api';
import { useLab } from '../store';
import { useTrace } from '../useTrace';
import { Waterfall } from '../components/Waterfall';

export function Traces() {
  const { traceId } = useParams();
  const { traces, clearLocal } = useLab();
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const { detail, error } = useTrace(traceId);
  const filtered = traces.filter((t) => !q || t.traceId.startsWith(q.toLowerCase()) || t.name.toLowerCase().includes(q.toLowerCase()) || t.services.some((s) => s.includes(q.toLowerCase())));

  return (
    <div className="page traces">
      <div className="page__head">
        <div>
          <h1>Request traces</h1>
          <p className="muted">Every request carries one <code>X-Request-ID</code>. Nginx, each service, the database calls and even RabbitMQ consumers report spans with that ID.</p>
        </div>
        <button className="btn" onClick={async () => { await lab('DELETE', '/telemetry'); clearLocal(); }}>Clear</button>
      </div>
      <div className="traces__grid">
        <section className="panel traces__list">
          <input className="input" placeholder="Filter by request ID, path or service…" value={q} onChange={(e) => setQ(e.target.value)} />
          <table className="table table--compact table--fixed">
            <thead><tr><th style={{ width: 92 }}>Time</th><th>Request</th><th style={{ width: 64 }}>Status</th><th style={{ width: 70 }}>Duration</th></tr></thead>
            <tbody>
              {filtered.slice(0, 200).map((t) => (
                <tr key={t.traceId} className={`clickable ${traceId === t.traceId ? 'is-selected' : ''}`} onClick={() => navigate(`/traces/${t.traceId}`)}>
                  <td className="mono small">{fmtTime(t.startTime)}</td>
                  <td className="ellipsis" title={t.name}>
                    <div className="mono small ellipsis">{t.name}</div>
                    <div className="muted small ellipsis">{t.services.filter((s) => s !== 'nginx').join(' · ')}{t.async && <span className="tag">async</span>}</div>
                  </td>
                  <td><span className={`status status--${t.httpStatus ? Math.floor(t.httpStatus / 100) : 0}`}>{t.httpStatus ?? '–'}</span>{t.errorCount > 0 && <span className="red small"> ⚠{t.errorCount}</span>}</td>
                  <td className="mono small">{fmtMs(t.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <div className="muted small">No traces match.</div>}
        </section>
        <section className="panel traces__detail">
          {!traceId ? (
            <div className="muted">Select a request on the left. Tip: the shop's API Inspector links straight here.</div>
          ) : error ? (
            <div className="alert alert--error">{error}</div>
          ) : !detail ? (
            <div className="muted">Loading…</div>
          ) : (
            <>
              <div className="panel__head">
                <div>
                  <h2>{detail.summary.name} <span className={`status status--${Math.floor((detail.summary.httpStatus ?? 0) / 100)}`}>{detail.summary.httpStatus}</span></h2>
                  <div className="mono small muted">X-Request-ID: {traceId}</div>
                </div>
                <div className="kpis">
                  <div><b>{fmtMs(detail.summary.durationMs)}</b><span>end-to-end</span></div>
                  <div><b>{detail.spans.length}</b><span>spans</span></div>
                  <div><b>{detail.summary.services.filter((s) => s !== 'nginx').length}</b><span>services</span></div>
                  <div><b>{detail.spans.filter((s) => s.kind === 'db').length}</b><span>DB calls</span></div>
                </div>
              </div>
              <Waterfall spans={detail.spans} logs={detail.logs} />
              <p className="muted small">Try it yourself: <code>docker compose logs | grep {traceId?.slice(0, 12)}</code></p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
