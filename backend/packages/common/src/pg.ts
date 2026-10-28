import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { sleep } from './config';
import { log } from './logger';
import { withSpan } from './tracer';

export type Query = <R extends QueryResultRow = any>(text: string, params?: unknown[]) => Promise<QueryResult<R>>;

/** "SELECT a, b FROM orders WHERE ..." -> "SELECT orders" (readable span names) */
function describe(sql: string) {
  const verb = sql.split(' ')[0].toUpperCase();
  const m =
    /^(?:SELECT|DELETE)\b.*?\bFROM\s+([\w.]+)/i.exec(sql) ??
    /^INSERT\s+INTO\s+([\w.]+)/i.exec(sql) ??
    /^UPDATE\s+([\w.]+)/i.exec(sql) ??
    /^TRUNCATE\s+([\w.]+)/i.exec(sql);
  return m ? `${verb} ${m[1]}` : sql.split(' ').slice(0, 2).join(' ');
}

const short = (v: unknown) => (typeof v === 'string' && v.length > 60 ? v.slice(0, 57) + '...' : v);

/** A Postgres pool whose queries show up as spans (with the SQL) in the teaching dashboard. */
export function createDb(connectionString: string, dbName: string) {
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 3000 });
  pool.on('error', (err) => log.error('Postgres pool error', { error: err.message }));

  async function run<R extends QueryResultRow>(text: string, params: unknown[] | undefined, client?: PoolClient) {
    const sql = text.replace(/\s+/g, ' ').trim();
    return withSpan(`SQL ${describe(sql)}`, 'db', { 'db.system': 'postgresql', 'db.name': dbName, 'db.statement': sql, 'db.params': params?.map(short) }, async (span) => {
      const r = await (client ?? pool).query<R>(text, params as any[]);
      span.setAttribute('db.rowCount', r.rowCount);
      return r;
    });
  }

  const query: Query = (text, params) => run(text, params);

  /** BEGIN ... COMMIT, or ROLLBACK if fn throws. Every statement is visible in the trace. */
  async function tx<T>(fn: (q: Query) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await run('BEGIN', undefined, client);
      const result = await fn((t, p) => run(t, p, client));
      await run('COMMIT', undefined, client);
      return result;
    } catch (err) {
      await run('ROLLBACK', undefined, client).catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function waitUntilReady(timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        await pool.query('SELECT 1');
        return;
      } catch (e) {
        if (Date.now() > deadline) throw e;
        log.warn('Waiting for Postgres...', { error: (e as Error).message });
        await sleep(2000);
      }
    }
  }

  const ping = async () => {
    await pool.query('SELECT 1');
  };

  return { pool, query, tx, waitUntilReady, ping };
}

export type Db = ReturnType<typeof createDb>;
