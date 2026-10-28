import { useMemo, useState } from 'react';
import { fmtMs, LogRecord, Span } from '../api';

/** Gantt-style view of every span in one request, including async consumers. */
export function Waterfall({ spans, logs }: { spans: Span[]; logs: LogRecord[] }) {
  const [selected, setSelected] = useState<Span | null>(null);
  const rows = useMemo(() => {
    const ids = new Set(spans.map((s) => s.spanId));
    const children = new Map<string | undefined, Span[]>();
    for (const s of spans) {
      const p = s.parentId && ids.has(s.parentId) ? s.parentId : undefined;
      children.set(p, [...(children.get(p) ?? []), s]);
    }
    const out: Array<{ span: Span; depth: number }> = [];
    const walk = (p: string | undefined, depth: number) => {
      for (const s of (children.get(p) ?? []).sort((a, b) => a.startTime - b.startTime)) {
        out.push({ span: s, depth });
        walk(s.spanId, depth + 1);
      }
    };
    walk(undefined, 0);
    return out;
  }, [spans]);
  if (!spans.length) return <div className="muted">No spans yet.</div>;
  const t0 = Math.min(...spans.map((s) => s.startTime));
  const t1 = Math.max(...spans.map((s) => s.startTime + s.durationMs));
  const total = Math.max(t1 - t0, 1);

  return (
    <div className="waterfall">
      <div className="waterfall__scale">
        <span>0 ms</span><span>{fmtMs(total / 2)}</span><span>{fmtMs(total)}</span>
      </div>
      {rows.map(({ span, depth }) => (
        <div
          key={span.spanId}
          className={`wf-row ${selected?.spanId === span.spanId ? 'is-selected' : ''} ${span.status === 'error' ? 'is-error' : ''}`}
          onClick={() => setSelected(span)}
        >
          <div className="wf-row__label" style={{ paddingLeft: depth * 14 }} title={span.name}>
            <span className={`svc svc--${span.service}`}>{span.service === 'product' ? span.instance : span.service === 'nginx' ? (span.instance === 'nginx-edge' ? 'nginx' : 'int-lb') : span.service}</span>
            <span className="wf-row__name">{span.name}</span>
          </div>
          <div className="wf-row__track">
            <div
              className={`wf-bar wf-bar--${span.kind}`}
              style={{ left: `${((span.startTime - t0) / total) * 100}%`, width: `max(2px, ${(span.durationMs / total) * 100}%)` }}
            />
            <span className="wf-row__dur" style={{ left: `min(calc(${((span.startTime - t0 + span.durationMs) / total) * 100}% + 4px), calc(100% - 60px))` }}>{fmtMs(span.durationMs)}</span>
          </div>
        </div>
      ))}
      <div className="legend">
        {['server', 'client', 'db', 'cache', 'producer', 'consumer', 'internal'].map((k) => (
          <span key={k}><i className={`wf-bar wf-bar--${k}`} /> {k}</span>
        ))}
      </div>
      {selected && (
        <div className="span-detail">
          <div className="span-detail__head">
            <strong>{selected.name}</strong>
            <button className="btn btn--ghost btn--sm" onClick={() => setSelected(null)}>Close</button>
          </div>
          <dl>
            <dt>service / instance</dt><dd>{selected.service} / {selected.instance}</dd>
            <dt>kind</dt><dd>{selected.kind}</dd>
            <dt>start offset</dt><dd>{fmtMs(selected.startTime - t0)}</dd>
            <dt>duration</dt><dd>{fmtMs(selected.durationMs)}</dd>
            <dt>status</dt><dd className={selected.status === 'error' ? 'red' : 'green'}>{selected.status}</dd>
            {Object.entries(selected.attributes).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => (
              <FragmentRow key={k} k={k} v={v} />
            ))}
          </dl>
        </div>
      )}
      <h3>Correlated logs <span className="muted small">({logs.length}, same request ID across all services)</span></h3>
      <LogTable logs={logs} />
    </div>
  );
}

const FragmentRow = ({ k, v }: { k: string; v: unknown }) => (
  <>
    <dt>{k}</dt>
    <dd className="mono">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
  </>
);

export function LogTable({ logs, showTrace }: { logs: LogRecord[]; showTrace?: boolean }) {
  if (!logs.length) return <div className="muted small">No log lines.</div>;
  return (
    <div className="logs">
      {logs.map((l, i) => {
        const { ts, level, service, instance, traceId, spanId, msg, ...fields } = l as any;
        return (
          <div key={i} className={`log log--${level}`}>
            <span className="log__ts">{ts.slice(11, 23)}</span>
            <span className={`log__lvl`}>{level}</span>
            <span className={`svc svc--${service}`}>{instance}</span>
            {showTrace && traceId && <a className="log__trace mono" href={`/traces/${traceId}`}>{traceId.slice(0, 8)}</a>}
            <span className="log__msg">{msg}</span>
            {Object.keys(fields).length > 0 && <span className="log__fields mono">{JSON.stringify(fields)}</span>}
          </div>
        );
      })}
    </div>
  );
}
