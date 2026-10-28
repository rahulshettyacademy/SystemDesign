import { useEffect, useState } from 'react';
import { lab } from '../api';

export function DataPage() {
  const [list, setList] = useState<Array<{ id: string; title: string; store: string }>>([]);
  const [active, setActive] = useState('orders');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  useEffect(() => void lab('GET', '/data').then((r) => setList(r.items)), []);
  useEffect(() => {
    let alive = true;
    const load = () => lab('GET', `/data/${active}`).then((d) => alive && (setData(d), setError(null))).catch((e) => alive && setError(e.message));
    void load();
    const t = auto ? setInterval(load, 2000) : undefined;
    return () => { alive = false; clearInterval(t); };
  }, [active, auto]);

  const rows: any[] = data?.rows ?? [];
  const isDoc = data?.store?.startsWith('MongoDB');
  const cols = rows.length && !isDoc ? Object.keys(rows[0]) : [];
  const groups = [...new Set(list.map((d) => d.store.split(' / ')[0]))];

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Data inspector <span className="tag">read-only</span></h1>
          <p className="muted">Real rows and documents, read with the <code>lab_readonly</code> role. Compare structured, related SQL tables with flexible MongoDB documents.</p>
        </div>
        <label className="checkbox"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto-refresh</label>
      </div>
      <div className="data-grid">
        <nav className="panel data-nav">
          {groups.map((g) => (
            <div key={g}>
              <div className="data-nav__group">{g}</div>
              {list.filter((d) => d.store.startsWith(g)).map((d) => (
                <button key={d.id} className={active === d.id ? 'is-on' : ''} onClick={() => setActive(d.id)}>{d.title}<span>{d.store.split(' / ')[1]}</span></button>
              ))}
            </div>
          ))}
        </nav>
        <section className="panel data-view">
          {error && <div className="alert alert--error">{error}</div>}
          {data && (
            <>
              <h3>{data.title} <span className="muted small">— {data.store} · {rows.length} rows</span></h3>
              <pre className="query">{data.query}</pre>
              {isDoc ? (
                <div className="docs">{rows.map((r, i) => <pre key={i} className="doc">{JSON.stringify(r, null, 2)}</pre>)}</div>
              ) : (
                <div className="table-wrap">
                  <table className="table table--compact">
                    <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>{cols.map((c) => <td key={c} className={`mono small ${r[c] === null ? 'muted' : ''}`}>{fmt(r[c])}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!rows.length && <div className="muted small">No rows.</div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

const fmt = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? v.replace('T', ' ').slice(0, 23) : String(v));
