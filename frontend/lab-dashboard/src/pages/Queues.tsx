import { useEffect, useState } from 'react';
import { lab } from '../api';

interface Q { name: string; ready: number; unacked: number; consumers: number; publishRate: number; deliverRate: number }

export function Queues() {
  const [data, setData] = useState<{ queues: Q[]; bindings: Array<{ queue: string; routingKey: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [peek, setPeek] = useState<{ queue: string; items: any[] } | null>(null);
  const [consumer, setConsumer] = useState<any>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    lab('GET', '/queues').then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
    lab('GET', '/consumers').then(setConsumer).catch(() => setConsumer(null));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, []);
  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000); };
  const q = (name: string) => data?.queues.find((x) => x.name === name);
  const groups = ['notification.order-created', 'inventory.order-created', 'cart.order-created'];
  const paused = consumer?.consumer?.paused;

  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Messaging (RabbitMQ)</h1>
          <p className="muted">When an order is confirmed, the order service writes <code>OrderCreated</code> to its outbox; a publisher sends it to the <code>shop.events</code> topic exchange. Three queues each get a copy (fan-out). Failed messages retry via a <code>.retry</code> queue (5 s delay) and land in a <code>.dlq</code> after 3 attempts.</p>
        </div>
        <a className="btn" href={`${location.protocol}//${location.hostname}:15672`} target="_blank" rel="noreferrer">RabbitMQ console ↗</a>
      </div>
      {error && <div className="alert alert--error">RabbitMQ management API unavailable: {error}</div>}
      {msg && <div className="alert alert--success">{msg}</div>}
      <section className="panel">
        <svg viewBox="0 0 1000 300" className="mq">
          <g transform="translate(20,120)"><rect width="150" height="60" rx="10" className="mq__box" /><text x="75" y="27" textAnchor="middle" className="mq__t">order service</text><text x="75" y="45" textAnchor="middle" className="mq__s">outbox → publish</text></g>
          <g transform="translate(240,110)"><rect width="160" height="80" rx="40" className="mq__ex" /><text x="80" y="38" textAnchor="middle" className="mq__t">shop.events</text><text x="80" y="56" textAnchor="middle" className="mq__s">topic exchange</text></g>
          <path d="M170,150 L240,150" className="mq__ln" markerEnd="url(#mqa)" />
          <defs><marker id="mqa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10z" fill="#94a3b8" /></marker></defs>
          {groups.map((g, i) => {
            const y = 20 + i * 95;
            const main = q(g); const dlq = q(`${g}.dlq`); const retry = q(`${g}.retry`);
            return (
              <g key={g}>
                <path d={`M400,150 C460,150 460,${y + 30} 520,${y + 30}`} className="mq__ln" markerEnd="url(#mqa)" />
                <g transform={`translate(520,${y})`}>
                  <rect width="210" height="60" rx="8" className={`mq__q ${main?.ready ? 'has-backlog' : ''}`} />
                  <text x="10" y="22" className="mq__t">{g}</text>
                  <text x="10" y="42" className="mq__s">ready {main?.ready ?? 0} · unacked {main?.unacked ?? 0} · consumers {main?.consumers ?? 0}</text>
                </g>
                <path d={`M730,${y + 30} L790,${y + 30}`} className="mq__ln" markerEnd="url(#mqa)" />
                <g transform={`translate(790,${y})`}>
                  <rect width="190" height="60" rx="8" className="mq__box" />
                  <text x="10" y="22" className="mq__t">{g.split('.')[0]} service</text>
                  <text x="10" y="42" className={`mq__s ${retry?.ready ? 'amber' : ''} ${dlq?.ready ? 'red' : ''}`}>retry {retry?.ready ?? 0} · DLQ {dlq?.ready ?? 0}</text>
                </g>
              </g>
            );
          })}
        </svg>
      </section>
      <div className="two-col">
        <section className="panel">
          <h3>Notification consumer</h3>
          <p className="small">State: {consumer ? (paused ? <b className="amber">PAUSED (messages accumulate)</b> : <b className="green">consuming</b>) : <b className="red">service unreachable</b>}</p>
          {consumer?.stats && <p className="small mono">processed {consumer.stats.processed} · duplicates ignored {consumer.stats.duplicatesIgnored} · failed attempts {consumer.stats.failedAttempts}</p>}
          <div className="btn-row">
            <button className="btn" disabled={!consumer || paused} onClick={() => lab('POST', '/scenarios/notification-paused/activate').then(load)}>Pause consumer</button>
            <button className="btn btn--primary" disabled={!consumer || !paused} onClick={() => lab('POST', '/scenarios/notification-paused/deactivate').then(load)}>Resume consumer</button>
            <button className="btn" onClick={() => lab('POST', '/events/republish', {}).then((r) => say(`Re-published event ${r.republished.join(', ') || '(none)'}: consumers will receive a DUPLICATE`))}>Re-deliver last event (duplicate)</button>
          </div>
        </section>
        <section className="panel">
          <h3>Dead-letter queue</h3>
          <p className="small muted">Messages that failed 3 times. Fix the cause first, then re-drive them to the main queue.</p>
          <div className="btn-row">
            <button className="btn" onClick={() => lab('GET', '/queues/notification.order-created.dlq/peek').then((r) => setPeek({ queue: 'notification.order-created.dlq', items: r.items }))}>Peek DLQ</button>
            <button className="btn btn--primary" onClick={() => lab('POST', '/queues/notification.order-created.dlq/redrive').then((r) => say(`Moved ${r.moved} message(s) back to notification.order-created`))}>Re-drive DLQ</button>
            <button className="btn" onClick={() => lab('GET', '/queues/notification.order-created/peek').then((r) => setPeek({ queue: 'notification.order-created', items: r.items }))}>Peek main queue</button>
          </div>
        </section>
      </div>
      {peek && (
        <section className="panel">
          <div className="panel__head"><h3>Messages in {peek.queue} ({peek.items.length})</h3><button className="btn btn--sm" onClick={() => setPeek(null)}>Close</button></div>
          {peek.items.length === 0 && <div className="muted small">Queue is empty.</div>}
          {peek.items.map((m, i) => (
            <div key={i} className="msg">
              <div className="small mono">messageId {m.properties.message_id} · type {m.properties.type} · request {m.properties.headers?.['x-request-id']?.slice(0, 12)}{m.properties.headers?.['x-final-error'] && <span className="red"> · error: {m.properties.headers['x-final-error']} after {m.properties.headers['x-attempts']} attempts</span>}</div>
              <pre>{JSON.stringify(m.payload, null, 2)}</pre>
            </div>
          ))}
        </section>
      )}
      <section className="panel">
        <h3>All queues</h3>
        <table className="table table--compact">
          <thead><tr><th>Queue</th><th>Ready</th><th>Unacked</th><th>Consumers</th><th>Publish/s</th><th>Deliver/s</th><th /></tr></thead>
          <tbody>
            {data?.queues.map((x) => (
              <tr key={x.name} className={x.name.endsWith('.dlq') && x.ready ? 'is-warn' : ''}>
                <td className="mono">{x.name}</td><td>{x.ready}</td><td>{x.unacked}</td><td>{x.consumers}</td>
                <td>{x.publishRate.toFixed(1)}</td><td>{x.deliverRate.toFixed(1)}</td>
                <td><button className="btn btn--sm" onClick={() => lab('POST', `/queues/${x.name}/purge`).then(() => say(`Purged ${x.name}`))}>Purge</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Bindings: {data?.bindings.map((b) => `${b.routingKey} → ${b.queue}`).join(' · ')}</p>
      </section>
    </div>
  );
}
