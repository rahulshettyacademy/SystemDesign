import { config } from './config';
import { UpstreamError } from './errors';
import { withSpan } from './tracer';

export interface CallOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface CallResult<T> {
  status: number;
  data: T;
  headers: Headers;
}

/**
 * Service-to-service HTTP call. Propagates the request ID, records a client span,
 * and turns network problems into UpstreamError so callers can decide:
 *   kind 'unavailable' -> request never reached the target (safe to fail fast)
 *   kind 'timeout'     -> OUTCOME UNKNOWN (the target may have done the work!)
 *   kind 'http'        -> target answered with an error status
 */
export async function callService<T = any>(target: string, url: string, opts: CallOptions = {}): Promise<CallResult<T>> {
  const method = opts.method ?? 'GET';
  const timeoutMs = opts.timeoutMs ?? 5000;
  const path = new URL(url).pathname;
  return withSpan(`${method} ${target}${path}`, 'client', { 'peer.service': target, 'http.method': method, 'http.url': url, timeoutMs }, async (span) => {
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-request-id': span.traceId,
          'x-parent-span-id': span.spanId,
          'x-internal-token': config.internalToken,
          ...opts.headers,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      if (e.name === 'TimeoutError' || e.name === 'AbortError') {
        span.setAttribute('outcome', 'timeout');
        throw new UpstreamError(target, 'timeout', `${target} did not respond within ${timeoutMs}ms`);
      }
      span.setAttribute('outcome', 'unavailable');
      throw new UpstreamError(target, 'unavailable', `${target} is unreachable (${e.cause?.code ?? e.message})`);
    }
    const text = await res.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    span.setAttributes({ 'http.status': res.status, 'served.by': res.headers.get('x-served-by') ?? undefined });
    if (!res.ok) {
      throw new UpstreamError(target, 'http', data?.error?.message ?? `${target} returned ${res.status}`, res.status, data);
    }
    return { status: res.status, data: data as T, headers: res.headers };
  });
}
