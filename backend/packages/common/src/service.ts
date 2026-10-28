import express, { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { als } from './context';
import { ApiError, UpstreamError } from './errors';
import { faultMiddleware, Faults } from './faults';
import { log } from './logger';
import { newTraceId, startSpan } from './tracer';

type HealthCheck = { fn: () => Promise<unknown>; critical: boolean };
type LabAction = (body: any) => Promise<unknown> | unknown;

/**
 * Creates an Express app with the conventions every QAMart service shares:
 *  - X-Request-ID propagation and a server span per request
 *  - /health (liveness) and /ready (dependency checks)
 *  - consistent JSON error responses
 *  - /__lab/* teaching endpoints (only when LAB_MODE=true, token protected, never routed by Nginx)
 */
export function createService() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  const healthChecks = new Map<string, HealthCheck>();
  const labActions = new Map<string, LabAction>();
  const resetHooks: Array<() => Promise<unknown>> = [];
  let labInfo: () => Promise<Record<string, unknown>> | Record<string, unknown> = () => ({});
  const startedAt = Date.now();

  // ---- tracing + diagnostics headers -------------------------------------------------
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health' || req.path === '/ready' || req.path.startsWith('/__lab')) {
      req.requestId = req.header('x-request-id') ?? newTraceId();
      return next();
    }
    const traceId = req.header('x-request-id') || newTraceId();
    const parentId = req.header('x-parent-span-id') || undefined;
    req.requestId = traceId;
    res.setHeader('X-Request-ID', traceId);
    if (config.labMode) res.setHeader('X-Served-By', config.instance);

    const span = startSpan(`${req.method} ${req.path}`, 'server', { 'http.method': req.method, 'http.target': req.originalUrl }, { traceId, spanId: parentId });
    const finish = () => {
      span.setAttributes({ 'http.status': res.statusCode, 'user.id': req.user?.id, aborted: !res.writableFinished || undefined });
      span.end(res.statusCode >= 500 ? 'error' : 'ok');
    };
    res.once('finish', finish);
    res.once('close', finish);
    als.run({ traceId, spanId: span.spanId }, () => next());
  });

  app.use(express.json({ limit: '100kb' }));

  // ---- health --------------------------------------------------------------------------
  app.get('/health', (_req, res) => {
    const down = config.labMode && Faults.get('http.unavailable', false);
    res.status(down ? 503 : 200).json({
      status: down ? 'DOWN' : 'UP',
      service: config.service,
      instance: config.instance,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  app.get('/ready', async (_req, res) => {
    const checks: Record<string, { status: 'UP' | 'DOWN'; latencyMs: number; error?: string; critical: boolean }> = {};
    await Promise.all(
      [...healthChecks.entries()].map(async ([name, c]) => {
        const t = Date.now();
        try {
          await Promise.race([c.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('health check timed out')), 1500))]);
          checks[name] = { status: 'UP', latencyMs: Date.now() - t, critical: c.critical };
        } catch (e) {
          checks[name] = { status: 'DOWN', latencyMs: Date.now() - t, error: (e as Error).message, critical: c.critical };
        }
      }),
    );
    const failed = Object.values(checks).filter((c) => c.status === 'DOWN');
    const injectedDown = config.labMode && Faults.get('http.unavailable', false);
    const status = injectedDown || failed.some((c) => c.critical) ? 'DOWN' : failed.length ? 'DEGRADED' : 'UP';
    res.status(status === 'DOWN' ? 503 : 200).json({
      status,
      service: config.service,
      instance: config.instance,
      checks,
      faults: config.labMode ? Faults.all() : undefined,
    });
  });

  // ---- teaching endpoints (LAB_MODE only) ---------------------------------------------
  if (config.labMode) {
    const lab = express.Router();
    lab.use((req, _res, next) => {
      if (req.header('x-lab-token') !== config.labToken) throw new ApiError(403, 'LAB_TOKEN_REQUIRED', 'Lab endpoints require the lab token');
      next();
    });
    lab.get('/info', async (_req, res) => {
      res.json({ service: config.service, instance: config.instance, faults: Faults.all(), actions: [...labActions.keys()], ...(await labInfo()) });
    });
    lab.put('/faults', (req, res) => {
      Faults.set(req.body ?? {});
      res.json({ instance: config.instance, faults: Faults.all() });
    });
    lab.delete('/faults', (_req, res) => {
      Faults.clear();
      res.json({ instance: config.instance, faults: Faults.all() });
    });
    lab.post('/reset', async (_req, res) => {
      Faults.clear();
      for (const hook of resetHooks) await hook();
      log.info('Lab reset complete');
      res.json({ instance: config.instance, reset: true });
    });
    lab.post('/actions/:name', async (req, res) => {
      const action = labActions.get(req.params.name);
      if (!action) throw new ApiError(404, 'UNKNOWN_ACTION', `No lab action ${req.params.name}`);
      res.json((await action(req.body ?? {})) ?? { ok: true });
    });
    app.use('/__lab', express.json(), lab);
  }

  app.use(['/api', '/internal'], faultMiddleware);

  async function start() {
    app.use((req: Request) => {
      throw new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`);
    });
    app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
      let status = 500;
      let body: { code: string; message: string; details?: unknown } = { code: 'INTERNAL_ERROR', message: 'Unexpected server error' };
      if (err instanceof ApiError) {
        status = err.status;
        body = { code: err.code, message: err.message, details: err.details };
      } else if (err instanceof UpstreamError) {
        status = err.kind === 'timeout' ? 504 : err.kind === 'unavailable' ? 503 : 502;
        body = {
          code: err.kind === 'timeout' ? 'UPSTREAM_TIMEOUT' : err.kind === 'unavailable' ? 'UPSTREAM_UNAVAILABLE' : 'UPSTREAM_ERROR',
          message: err.message,
          details: { target: err.target, upstreamStatus: err.status, upstreamCode: err.code },
        };
      } else if (err?.type === 'entity.parse.failed') {
        status = 400;
        body = { code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
      } else if (err?.type === 'entity.too.large') {
        status = 413;
        body = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
      }
      if (status >= 500) log.error('Request failed', { status, code: body.code, error: err?.message, stack: status === 500 ? err?.stack : undefined });
      else log.info('Request rejected', { status, code: body.code, message: body.message });
      if (!res.headersSent) res.status(status).json({ error: { ...body, requestId: req.requestId } });
    });

    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const srv = app.listen(config.port, () => resolve(srv));
    });
    log.info(`${config.service} listening`, { port: config.port, labMode: config.labMode });
    // Graceful shutdown: stop accepting connections so the load balancer fails over immediately.
    const shutdown = (signal: string) => {
      log.warn(`Received ${signal}: shutting down`);
      server.close();
      server.closeAllConnections?.();
      setTimeout(() => process.exit(0), 300).unref();
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  }

  return {
    app,
    start,
    /** critical=false means "degraded" rather than "down" when this dependency fails */
    healthCheck(name: string, fn: () => Promise<unknown>, critical = true) {
      healthChecks.set(name, { fn, critical });
    },
    labAction(name: string, fn: LabAction) {
      labActions.set(name, fn);
    },
    onLabReset(fn: () => Promise<unknown>) {
      resetHooks.push(fn);
    },
    setLabInfo(fn: typeof labInfo) {
      labInfo = fn;
    },
  };
}
