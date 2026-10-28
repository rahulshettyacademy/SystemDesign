import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { lab } from '../api';

function DemoCard({ title, concept, children }: { title: string; concept: string; children: ReactNode }) {
  return (
    <section className="panel demo">
      <div className="demo__concept">{concept}</div>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

const TraceLink = ({ id }: { id?: string }) => (id ? <Link className="mono small" to={`/traces/${id}`}>{id.slice(0, 10)}… ↗</Link> : null);

export function Demos() {
  const [busy, setBusy] = useState<string | null>(null);
  const [race, setRace] = useState<any>(null);
  const [dup, setDup] = useState<any>(null);
  const [timeout, setTimeoutResult] = useState<any>(null);
  const [sale, setSale] = useState<any>(null);
  const [saleActive, setSaleActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void lab('GET', '/sale').then((r) => setSaleActive(r.active)), []);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runRace = (unsafe: boolean) =>
    run(unsafe ? 'race-unsafe' : 'race', async () => {
      if (unsafe) await lab('POST', '/scenarios/unsafe-inventory/activate');
      try {
        setRace({ unsafe, ...(await lab('POST', '/demos/race-last-item', {})) });
      } finally {
        if (unsafe) await lab('POST', '/scenarios/unsafe-inventory/deactivate');
      }
    });

  const runTimeout = () =>
    run('timeout', async () => {
      await lab('POST', '/scenarios/payment-timeout/activate');
      try {
        const r = await lab('POST', '/demos/place-order', {});
        const pay = await lab('GET', '/data/payments');
        setTimeoutResult({ order: r.steps[r.steps.length - 1], payment: pay.rows[0] });
      } finally {
        await lab('POST', '/scenarios/payment-timeout/deactivate');
      }
    });

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Guided demos</h1>
          <p className="muted">One-click, repeatable experiments that drive real traffic through the gateway. Each result links to the traces that prove it.</p>
        </div>
      </div>
      {error && <div className="alert alert--error">{error}</div>}
      <div className="demo-grid">
        <DemoCard concept="Concurrency · SQL row locks" title="Two customers buy the LAST unit at the same moment">
          <p className="small muted">Sets <code>iphone-15-pro-256</code> stock to 1, then Alice and Bob check out in parallel.</p>
          <div className="btn-row">
            <button className="btn btn--primary" disabled={!!busy} onClick={() => runRace(false)}>{busy === 'race' ? 'Racing…' : 'Run (correct code)'}</button>
            <button className="btn btn--danger" disabled={!!busy} onClick={() => runRace(true)}>{busy === 'race-unsafe' ? 'Racing…' : 'Run with the race-condition BUG'}</button>
          </div>
          {race && (
            <div className={`result ${race.winners > 1 ? 'result--bad' : 'result--good'}`}>
              <strong>{race.verdict}</strong> {race.unsafe && <span className="tag tag--warn">unsafe mode</span>}
              <table className="table table--compact">
                <tbody>
                  {race.results.map((r: any) => (
                    <tr key={r.user}><td>{r.user}</td><td><span className={`status status--${Math.floor(r.status / 100)}`}>{r.status}</span></td><td className="small">{r.errorCode ?? r.orderStatus}</td><td><TraceLink id={r.requestId} /></td></tr>
                  ))}
                </tbody>
              </table>
              <div className="small mono">units sold this run: {race.unitsSoldThisRun} · stock after: available {race.stockAfter.available}, reserved {race.stockAfter.reserved}</div>
            </div>
          )}
        </DemoCard>

        <DemoCard concept="Idempotency" title="Duplicate order request (double click + retry)">
          <p className="small muted">Sends the same <code>Idempotency-Key</code> twice at once, then once more a second later.</p>
          <button className="btn btn--primary" disabled={!!busy} onClick={() => run('dup', async () => setDup(await lab('POST', '/demos/duplicate-order')))}>{busy === 'dup' ? 'Sending…' : 'Run'}</button>
          {dup && (
            <div className={`result ${dup.verdict.startsWith('Correct') ? 'result--good' : 'result--bad'}`}>
              <strong>{dup.verdict}</strong>
              <table className="table table--compact">
                <tbody>
                  {dup.requests.map((r: any) => (
                    <tr key={r.step}><td className="small">{r.step}</td><td><span className={`status status--${Math.floor(r.status / 100)}`}>{r.status}</span></td><td className="small">{r.errorCode ?? (r.status === 200 ? 'replayed original' : r.orderStatus)}</td><td><TraceLink id={r.requestId} /></td></tr>
                  ))}
                </tbody>
              </table>
              <div className="small mono">orders in DB with this key: {dup.ordersInDatabase.length} · payments: {dup.paymentsInDatabase.length}</div>
            </div>
          )}
        </DemoCard>

        <DemoCard concept="Distributed systems" title="Charged, but the payment response timed out">
          <p className="small muted">The payment commits the charge, then answers after 8 s. The order service gives up after 3 s and retries with the SAME key.</p>
          <button className="btn btn--primary" disabled={!!busy} onClick={runTimeout}>{busy === 'timeout' ? 'Waiting for retry… (~4 s)' : 'Run'}</button>
          {timeout && (
            <div className={`result ${timeout.payment?.request_count >= 2 ? 'result--good' : ''}`}>
              <strong>Order {timeout.order.orderNumber}: {timeout.order.orderStatus}</strong> in {timeout.order.ms} ms <TraceLink id={timeout.order.requestId} />
              <div className="small mono">payments row: status {timeout.payment?.status} · request_count {timeout.payment?.request_count} · amount ₹{timeout.payment?.amount}</div>
              <div className="small">One charge, two requests: the retry got the original result back.</div>
            </div>
          )}
        </DemoCard>

        <DemoCard concept="Diwali sale mode" title="Limited stock + sale prices + DIWALI50">
          <p className="small muted">Activates sale prices in MongoDB, limits stock of lightning deals (e.g. iPhone 15 → 5 units) and enables the <code>DIWALI50</code> coupon (once per customer, 100 uses).</p>
          <div className="btn-row">
            <button className="btn btn--primary" disabled={!!busy || saleActive} onClick={() => run('sale', async () => { setSale(await lab('POST', '/sale', { active: true })); setSaleActive(true); })}>Start Diwali sale</button>
            <button className="btn" disabled={!!busy || !saleActive} onClick={() => run('sale', async () => { setSale(await lab('POST', '/sale', { active: false })); setSaleActive(false); })}>End sale</button>
          </div>
          <div className="small">Status: {saleActive ? <b className="amber">SALE ACTIVE</b> : 'normal prices'}</div>
          {sale?.deals && (
            <table className="table table--compact">
              <thead><tr><th>Deal</th><th>Sale price</th><th>Limited stock</th></tr></thead>
              <tbody>{sale.deals.map((d: any) => <tr key={d.id}><td className="small">{d.name}</td><td>₹{d.salePrice.toLocaleString('en-IN')}</td><td>{d.limitedStock ?? '—'}</td></tr>)}</tbody>
            </table>
          )}
        </DemoCard>
      </div>
    </div>
  );
}
