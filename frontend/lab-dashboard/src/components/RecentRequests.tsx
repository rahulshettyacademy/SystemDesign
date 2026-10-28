import { fmtMs, fmtTime, TraceSummary } from '../api';

export function RecentRequests({ traces, selected, onSelect, limit = 12 }: { traces: TraceSummary[]; selected?: string | null; onSelect: (id: string) => void; limit?: number }) {
  if (!traces.length) return <div className="muted small">No requests yet. Use the shop or press a demo button.</div>;
  return (
    <div className="reqlist">
      {traces.slice(0, limit).map((t) => (
        <button key={t.traceId} className={`req ${selected === t.traceId ? 'is-selected' : ''}`} onClick={() => onSelect(t.traceId)}>
          <span className={`status status--${t.httpStatus ? Math.floor(t.httpStatus / 100) : 0}`}>{t.httpStatus ?? '–'}</span>
          <span className="req__name">{t.name}</span>
          <span className="req__meta">{t.services.filter((s) => s !== 'nginx').length} svc · {fmtMs(t.durationMs)}{t.async ? ' · async' : ''}</span>
          <span className="req__time">{fmtTime(t.startTime)}</span>
        </button>
      ))}
    </div>
  );
}
