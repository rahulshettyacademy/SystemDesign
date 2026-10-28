import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { config } from './config';
import { als, currentContext, TraceContext } from './context';

export type SpanKind = 'server' | 'client' | 'db' | 'cache' | 'producer' | 'consumer' | 'internal';

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentId?: string;
  service: string;
  instance: string;
  name: string;
  kind: SpanKind;
  startTime: number;
  durationMs: number;
  status: 'ok' | 'error';
  attributes: Record<string, unknown>;
}

export interface LogRecord {
  ts: string;
  level: string;
  service: string;
  instance: string;
  traceId?: string;
  spanId?: string;
  msg: string;
  [k: string]: unknown;
}

export const newSpanId = () => randomBytes(8).toString('hex');
export const newTraceId = () => randomBytes(16).toString('hex');
// performance.now() is precise but stops while the host sleeps (Docker Desktop pauses its VM),
// so timeOrigin + now() drifts behind real time by a different amount in every container and
// spans from different services stop lining up. Re-anchor to the wall clock as soon as they
// diverge by more than Date.now()'s 1 ms resolution: calls between services are ms apart.
const MAX_DRIFT_MS = 2;
let anchorWall = Date.now();
let anchorMono = performance.now();
const now = () => {
  const t = anchorWall + (performance.now() - anchorMono);
  if (Math.abs(Date.now() - t) <= MAX_DRIFT_MS) return t;
  anchorWall = Date.now();
  anchorMono = performance.now();
  return anchorWall;
};

/** Buffers spans/logs and ships them to the lab service in small batches (LAB_MODE only). */
class Exporter {
  private spans: SpanRecord[] = [];
  private logs: LogRecord[] = [];
  private timer?: NodeJS.Timeout;

  addSpan(s: SpanRecord) {
    if (!config.labMode) return;
    if (this.spans.length < 5000) this.spans.push(s);
    this.schedule();
  }
  addLog(l: LogRecord) {
    if (!config.labMode) return;
    if (this.logs.length < 5000) this.logs.push(l);
    this.schedule();
  }
  private schedule() {
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), 300);
  }
  async flush() {
    this.timer = undefined;
    const spans = this.spans.splice(0);
    const logs = this.logs.splice(0);
    if (!spans.length && !logs.length) return;
    try {
      await fetch(`${config.labUrl}/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-lab-token': config.labToken },
        body: JSON.stringify({ spans, logs }),
        signal: AbortSignal.timeout(2000),
      });
    } catch {
      /* The lab service is optional; telemetry loss must never break the shop. */
    }
  }
}
export const exporter = new Exporter();

export class Span {
  readonly spanId = newSpanId();
  readonly startTime = now();
  private attrs: Record<string, unknown>;
  private ended = false;

  constructor(
    readonly name: string,
    readonly kind: SpanKind,
    attrs: Record<string, unknown>,
    readonly traceId: string,
    readonly parentId: string | undefined,
    private readonly suppressed = false,
  ) {
    this.attrs = { ...attrs };
  }
  setAttribute(k: string, v: unknown) {
    this.attrs[k] = v;
    return this;
  }
  setAttributes(o: Record<string, unknown>) {
    Object.assign(this.attrs, o);
    return this;
  }
  end(status: 'ok' | 'error' = 'ok') {
    if (this.ended) return;
    this.ended = true;
    if (this.suppressed || !this.traceId) return;
    exporter.addSpan({
      traceId: this.traceId,
      spanId: this.spanId,
      parentId: this.parentId,
      service: config.service,
      instance: config.instance,
      name: this.name,
      kind: this.kind,
      startTime: this.startTime,
      durationMs: Math.round((now() - this.startTime) * 100) / 100,
      status,
      attributes: this.attrs,
    });
  }
  fail(err: unknown) {
    const e = err as { message?: string; code?: string };
    this.setAttributes({ 'error.message': e?.message ?? String(err), 'error.code': e?.code });
    this.end('error');
  }
}

/** Start a span as a child of the current context (or a new trace). */
export function startSpan(name: string, kind: SpanKind, attrs: Record<string, unknown> = {}, parent?: TraceContext) {
  const ctx = parent ?? currentContext();
  const traceId = ctx?.traceId || newTraceId();
  return new Span(name, kind, attrs, traceId, ctx?.spanId, ctx?.suppressed);
}

/** Run fn inside a child span; the span ends (ok/error) when fn settles. */
export async function withSpan<T>(
  name: string,
  kind: SpanKind,
  attrs: Record<string, unknown>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const parent = currentContext();
  const span = startSpan(name, kind, attrs, parent);
  return als.run({ traceId: span.traceId, spanId: span.spanId, suppressed: parent?.suppressed }, async () => {
    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (err) {
      span.fail(err);
      throw err;
    }
  });
}

/** Continue an existing trace (e.g. from a RabbitMQ message header or a stored order). */
export function runInTrace<T>(traceId: string | undefined, parentSpanId: string | undefined, fn: () => Promise<T>) {
  return als.run({ traceId: traceId || newTraceId(), spanId: parentSpanId }, fn);
}
