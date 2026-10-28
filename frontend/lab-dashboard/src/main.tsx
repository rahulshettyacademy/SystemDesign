import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { LabProvider, useLab } from './store';
import { SHOP_URL } from './api';
import { Architecture } from './pages/Architecture';
import { Traces } from './pages/Traces';
import { HealthPage } from './pages/Health';
import { Failures } from './pages/Failures';
import { LoadBalancer } from './pages/LoadBalancer';
import { Cache } from './pages/Cache';
import { Queues } from './pages/Queues';
import { DataPage } from './pages/Data';
import { Demos } from './pages/Demos';
import { Logs } from './pages/Logs';
import './styles.css';

const NAV = [
  ['/architecture', 'Architecture', '◎'],
  ['/traces', 'Request traces', '≋'],
  ['/health', 'Service health', '♥'],
  ['/failures', 'Failure lab', '⚡'],
  ['/demos', 'Guided demos', '▶'],
  ['/load-balancer', 'Load balancer', '⇶'],
  ['/cache', 'Cache', '◷'],
  ['/queues', 'Messaging', '✉'],
  ['/data', 'Data (SQL / NoSQL)', '⛁'],
  ['/logs', 'Logs', '☰'],
];

function Shell() {
  const { connected, health } = useLab();
  const down = Object.values(health).filter((h) => h.status === 'DOWN').length;
  const degraded = Object.values(health).filter((h) => h.status === 'DEGRADED').length;
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand__logo">QA<span>Mart</span> Lab</div>
          <div className="brand__sub">System Design for Test Engineers</div>
        </div>
        <nav>
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'is-active' : '')}>
              <span className="side__icon">{icon}</span>{label}
              {to === '/health' && (down > 0 || degraded > 0) && <span className={`side__badge ${down ? 'red' : 'amber'}`}>{down || degraded}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="side__foot">
          <a href={SHOP_URL} target="_blank" rel="noreferrer">Open the shop ↗</a>
          <a href={`${SHOP_URL}/api-docs/`} target="_blank" rel="noreferrer">API docs ↗</a>
          <div className={`conn ${connected ? 'is-on' : ''}`}><span />{connected ? 'live' : 'disconnected'}</div>
          <div className="side__warn">LOCAL TEACHING TOOL · disabled in production mode</div>
        </div>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/architecture" replace />} />
          <Route path="/architecture" element={<Architecture />} />
          <Route path="/traces" element={<Traces />} />
          <Route path="/traces/:traceId" element={<Traces />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/failures" element={<Failures />} />
          <Route path="/demos" element={<Demos />} />
          <Route path="/load-balancer" element={<LoadBalancer />} />
          <Route path="/cache" element={<Cache />} />
          <Route path="/queues" element={<Queues />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="*" element={<Navigate to="/architecture" replace />} />
        </Routes>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <LabProvider>
        <Shell />
      </LabProvider>
    </BrowserRouter>
  </StrictMode>,
);
