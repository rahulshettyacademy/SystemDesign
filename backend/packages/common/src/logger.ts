import { config } from './config';
import { currentContext } from './context';
import { exporter, LogRecord } from './tracer';

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  const ctx = currentContext();
  const rec: LogRecord = {
    ts: new Date().toISOString(),
    level,
    service: config.service,
    instance: config.instance,
    traceId: ctx?.traceId || undefined,
    spanId: ctx?.spanId,
    msg,
    ...fields,
  };
  // One JSON line per event: `docker compose logs | grep <request-id>` finds every hop.
  const line = JSON.stringify(rec);
  if (level === 'error') console.error(line);
  else console.log(line);
  if (!ctx?.suppressed) exporter.addLog(rec);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, f),
};
