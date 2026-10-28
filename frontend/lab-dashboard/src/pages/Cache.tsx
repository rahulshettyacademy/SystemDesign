import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtTime, lab } from '../api';

interface Probe { requestId: string; status: number; cache: string; servedBy: string; ms: number; price: number; name: string; at: number }
const PRODUCTS = ['iphone-15-128', 'galaxy-s24-256', 'airpods-pro-2', 'macbook-air-m3', 'diya-set-12'];

export function Cache() {
  const navigate = useNavigate();
  const [state, setState] = useState<any>(null);
  const [productId, setProductId] = useState('iphone-15-128');
  const [probes, setProbes] = useState<Probe[]>([]);
  const [price, setPrice] = useState('');
  const [ttl, setTtl] = useState(60);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => lab('GET', '/cache').then(setState).catch(() => undefined);
  useEffect(() => {
    void load();
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, []);
  const settings = state?.instances?.find((i: any) => i.settings)?.settings;
  useEffect(() => { if (settings) setTtl(settings.ttlSeconds); }, [settings?.ttlSeconds]);

  const probe = async () => {
    const p = await lab<Probe>('GET', `/cache/probe/${productId}`);
    setProbes((prev) => [p, ...prev].slice(0, 30));
  };
  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000); };
  const updatePrice = async () => {
    const r = await lab('POST', `/products/${productId}/price`, { price: Number(price) });
    say(`MongoDB updated: ${r.product.name} now ₹${r.product.price.toLocaleString('en-IN')} (via ${r.via}). Cache invalidated: ${r.cacheInvalidated ? 'YES' : 'NO - cached copy is now STALE'}`);
    void load();
  };
  const totals = (state?.instances ?? []).reduce((a: any, i: any) => {
    for (const k of ['hits', 'misses', 'bypass', 'errors']) a[k] = (a[k] ?? 0) + (i.stats?.[k] ?? 0);
    return a;
  }, {});
  const hitRate = totals.hits + totals.misses > 0 ? Math.round((totals.hits / (totals.hits + totals.misses)) * 100) : 0;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Redis cache (cache-aside)</h1>
          <p className="muted">Product details: read Redis → on MISS read MongoDB and store with a TTL. Admin price updates DELETE the key (invalidation). Checkout never trusts the cache for prices.</p>
        </div>
        <div className="kpis">
          <div className="green"><b>{totals.hits ?? 0}</b><span>hits</span></div>
          <div className="amber"><b>{totals.misses ?? 0}</b><span>misses</span></div>
          <div><b>{totals.bypass ?? 0}</b><span>bypass</span></div>
          <div><b>{hitRate}%</b><span>hit rate</span></div>
        </div>
      </div>
      {state && !state.redisUp && <div className="alert alert--error">Redis is DOWN: product reads bypass the cache and go straight to MongoDB.</div>}
      <div className="two-col">
        <section className="panel">
          <h3>1 · Probe a product through the load balancer</h3>
          <div className="form-row">
            <label>Product <select value={productId} onChange={(e) => setProductId(e.target.value)}>{PRODUCTS.map((p) => <option key={p}>{p}</option>)}</select></label>
            <button className="btn btn--primary" onClick={probe}>GET /api/products/{productId}</button>
          </div>
          <table className="table table--compact">
            <thead><tr><th>Time</th><th>X-Cache</th><th>Served by</th><th>Price shown</th><th>ms</th></tr></thead>
            <tbody>
              {probes.map((p) => (
                <tr key={p.requestId} className="clickable" onClick={() => navigate(`/traces/${p.requestId}`)}>
                  <td className="mono small">{fmtTime(p.at)}</td>
                  <td><span className={`cache cache--${(p.cache ?? 'none').toLowerCase()}`}>{p.cache ?? '—'}</span></td>
                  <td className="mono small">{p.servedBy}</td>
                  <td className="mono">₹{p.price?.toLocaleString('en-IN')}</td>
                  <td className="mono small">{p.ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!probes.length && <div className="muted small">Press the button: first a MISS (loaded from MongoDB), then HITs from any instance (the cache is shared).</div>}
        </section>
        <section className="panel">
          <h3>2 · Change the price (admin write to MongoDB)</h3>
          <div className="form-row">
            <label>New price (₹) <input type="number" value={price} placeholder="e.g. 74900" onChange={(e) => setPrice(e.target.value)} /></label>
            <button className="btn btn--primary" disabled={!price} onClick={updatePrice}>Update {productId}</button>
          </div>
          {msg && <div className="alert alert--warn small">{msg}</div>}
          <h3>3 · Cache settings (all product instances)</h3>
          <div className="form-row">
            <label>TTL (s) <input type="number" min={1} value={ttl} onChange={(e) => setTtl(Number(e.target.value))} /></label>
            <button className="btn" onClick={() => lab('POST', '/cache/settings', { ttlSeconds: ttl }).then(load)}>Apply TTL</button>
            <label className="checkbox">
              <input type="checkbox" checked={settings?.invalidateOnUpdate ?? true} onChange={(e) => lab('POST', '/cache/settings', { invalidateOnUpdate: e.target.checked }).then(load)} />
              Invalidate on update
            </label>
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => lab('POST', '/cache/invalidate', { id: productId }).then(() => say(`Deleted product:${productId}`))}>Invalidate {productId}</button>
            <button className="btn btn--danger" onClick={() => lab('POST', '/cache/invalidate', {}).then((r) => say(`Flushed ${r.invalidated} keys`))}>Flush all product keys</button>
          </div>
          <h3>Per-instance counters</h3>
          <table className="table table--compact">
            <thead><tr><th>Instance</th><th>TTL</th><th>Invalidate</th><th>Hits</th><th>Misses</th><th>Bypass</th></tr></thead>
            <tbody>
              {(state?.instances ?? []).map((i: any) => (
                <tr key={i.instance}>
                  <td>{i.instance}</td>
                  {i.unreachable ? <td colSpan={5} className="red">unreachable</td> : (
                    <><td>{i.settings.ttlSeconds}s</td><td>{i.settings.invalidateOnUpdate ? 'on' : <b className="red">OFF</b>}</td><td>{i.stats.hits}</td><td>{i.stats.misses}</td><td>{i.stats.bypass}</td></>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      <section className="panel">
        <h3>Keys currently in Redis <span className="muted small">(refreshes every second; watch the TTL count down)</span></h3>
        <table className="table table--compact">
          <thead><tr><th>Key</th><th>TTL remaining</th><th>Cached price</th><th>Cached name</th></tr></thead>
          <tbody>
            {(state?.keys ?? []).map((k: any) => (
              <tr key={k.key}>
                <td className="mono">{k.key}</td>
                <td><div className="ttl"><div style={{ width: `${Math.min(100, (k.ttlSeconds / (settings?.ttlSeconds || 60)) * 100)}%` }} /></div><span className="mono small">{k.ttlSeconds}s</span></td>
                <td className="mono">₹{k.price?.toLocaleString('en-IN')}</td>
                <td className="small">{k.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {state?.keys?.length === 0 && <div className="muted small">Cache is empty.</div>}
      </section>
    </div>
  );
}
