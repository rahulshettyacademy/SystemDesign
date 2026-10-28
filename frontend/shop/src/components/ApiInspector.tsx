import { useState } from 'react';
import { dashboardTraceUrl } from '../api';
import { useApp } from '../state';

/**
 * DEVELOPMENT-ONLY diagnostic drawer. It appears only when the backend sends diagnostic
 * headers (LAB_MODE). It lists every API call with its status, timing, request ID,
 * the instance that served it and whether it came from the cache.
 */
export function ApiInspector() {
  const { calls, labMode } = useApp();
  const [open, setOpen] = useState(false);
  if (!labMode) return null;
  return (
    <div className={`inspector ${open ? 'inspector--open' : ''}`}>
      <button className="inspector__toggle" onClick={() => setOpen(!open)} data-testid="api-inspector-toggle" title="API Inspector (lab mode only)">
        <span className="inspector__dot" /> API Inspector <span className="inspector__count">{calls.length}</span>
      </button>
      {open && (
        <div className="inspector__panel" data-testid="api-inspector">
          <div className="inspector__head">
            <strong>Live API calls from this browser</strong>
            <span className="muted">Same data as DevTools → Network. Click a request ID to see its full trace.</span>
          </div>
          <table>
            <thead>
              <tr><th>Method</th><th>Path</th><th>Status</th><th>ms</th><th>Served by</th><th>Cache</th><th>Request ID</th></tr>
            </thead>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id} className={c.status >= 400 || c.status === 0 ? 'is-error' : ''}>
                  <td><span className={`method method--${c.method.toLowerCase()}`}>{c.method}</span></td>
                  <td className="mono path" title={c.path}>{c.path}</td>
                  <td className="mono">{c.status || 'ERR'}{c.errorCode ? <div className="code">{c.errorCode}</div> : null}</td>
                  <td className="mono">{c.ms}</td>
                  <td className="mono">{c.servedBy ?? '–'}</td>
                  <td>{c.cache ? <span className={`cache cache--${c.cache.toLowerCase()}`}>{c.cache}</span> : '–'}</td>
                  <td className="mono">{c.requestId ? <a href={dashboardTraceUrl(c.requestId)} target="_blank" rel="noreferrer">{c.requestId.slice(0, 12)}…</a> : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
