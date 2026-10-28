import { useState } from 'react';
import { useLab } from '../store';
import { LogTable } from '../components/Waterfall';

const SERVICES = ['', 'auth', 'product', 'cart', 'inventory', 'order', 'payment', 'notification'];

export function Logs() {
  const { logs } = useLab();
  const [service, setService] = useState('');
  const [level, setLevel] = useState('');
  const [q, setQ] = useState('');
  const shown = logs.filter((l) => (!service || l.service === service) && (!level || l.level === level) && (!q || JSON.stringify(l).toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="page">
      <div className="page__head">
        <div>
          <h1>Live logs</h1>
          <p className="muted">Structured JSON logs from every service. Each line carries the request ID, so you can jump from a log line to the whole request.</p>
        </div>
      </div>
      <section className="panel">
        <div className="form-row">
          <label>Service <select value={service} onChange={(e) => setService(e.target.value)}>{SERVICES.map((s) => <option key={s} value={s}>{s || 'all'}</option>)}</select></label>
          <label>Level <select value={level} onChange={(e) => setLevel(e.target.value)}>{['', 'info', 'warn', 'error'].map((s) => <option key={s} value={s}>{s || 'all'}</option>)}</select></label>
          <label className="grow">Search <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="request id, order number, message…" /></label>
          <span className="muted small">{shown.length} lines</span>
        </div>
        <LogTable logs={shown.slice(0, 400)} showTrace />
      </section>
    </div>
  );
}
