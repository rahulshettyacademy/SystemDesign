import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { Health, lab, LbRecord, LogRecord, TraceSummary } from './api';

interface LabState {
  connected: boolean;
  health: Record<string, Health>;
  traces: TraceSummary[];
  logs: LogRecord[];
  lb: LbRecord[];
  clearLocal: () => void;
}
const Ctx = createContext<LabState>(null!);
export const useLab = () => useContext(Ctx);

/** One Server-Sent Events stream feeds every page: health, traces, logs and load-balancer records. */
export function LabProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [health, setHealth] = useState<Record<string, Health>>({});
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [lb, setLb] = useState<LbRecord[]>([]);
  const pending = useRef<{ traces: Map<string, TraceSummary>; logs: LogRecord[]; lb: LbRecord[] }>({ traces: new Map(), logs: [], lb: [] });

  useEffect(() => {
    lab<{ items: TraceSummary[] }>('GET', '/traces?limit=200').then((r) => setTraces(r.items)).catch(() => undefined);
    lab<{ items: LogRecord[] }>('GET', '/logs?limit=300').then((r) => setLogs(r.items)).catch(() => undefined);
    lab<{ recent: LbRecord[] }>('GET', '/lb').then((r) => setLb(r.recent)).catch(() => undefined);

    const es = new EventSource('/lab/api/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener('health', (e) => setHealth(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('trace', (e) => {
      const t: TraceSummary = JSON.parse((e as MessageEvent).data);
      pending.current.traces.set(t.traceId, t);
    });
    es.addEventListener('log', (e) => pending.current.logs.push(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('lb', (e) => pending.current.lb.push(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('cleared', () => {
      setTraces([]);
      setLogs([]);
      setLb([]);
    });
    // Batch UI updates so a burst of traffic doesn't re-render hundreds of times per second.
    const flush = setInterval(() => {
      const p = pending.current;
      if (p.traces.size) {
        const updates = new Map(p.traces);
        p.traces.clear();
        setTraces((prev) => {
          const rest = prev.filter((t) => !updates.has(t.traceId));
          return [...updates.values(), ...rest].sort((a, b) => b.startTime - a.startTime).slice(0, 300);
        });
      }
      if (p.logs.length) {
        const add = p.logs.splice(0);
        setLogs((prev) => [...add.reverse(), ...prev].slice(0, 1000));
      }
      if (p.lb.length) {
        const add = p.lb.splice(0);
        setLb((prev) => [...add.reverse(), ...prev].slice(0, 500));
      }
    }, 400);
    return () => {
      es.close();
      clearInterval(flush);
    };
  }, []);

  const clearLocal = () => {
    setTraces([]);
    setLogs([]);
    setLb([]);
  };
  return <Ctx.Provider value={{ connected, health, traces, logs, lb, clearLocal }}>{children}</Ctx.Provider>;
}
