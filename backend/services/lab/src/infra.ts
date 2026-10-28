/** Connections the lab uses to OBSERVE infrastructure (read-only DB roles, Redis, RabbitMQ management API). */
import amqp from 'amqplib';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import { Pool } from 'pg';
import { config, sleep } from '@qamart/common';
import { instanceUrl } from './topology';

const PG_BASE = process.env.PG_READONLY_URL ?? 'postgres://lab_readonly:lab_readonly_pw@postgres:5432';
export const pg: Record<string, Pool> = {};
for (const dbName of ['auth_db', 'cart_db', 'order_db', 'payment_db', 'inventory_db']) {
  pg[dbName] = new Pool({ connectionString: `${PG_BASE}/${dbName}`, max: 3, connectionTimeoutMillis: 2000 });
  pg[dbName].on('error', () => undefined);
}

export const mongo = new MongoClient(process.env.MONGO_READONLY_URL ?? 'mongodb://lab_readonly:lab_readonly_pw@mongodb:27017/?authSource=admin', {
  serverSelectionTimeoutMS: 1500,
});
void mongo.connect().catch(() => undefined);

export const redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  connectTimeout: 1000,
  commandTimeout: 1000,
  retryStrategy: (n) => Math.min(n * 500, 3000),
});
redis.on('error', () => undefined);

const RABBIT_URL = process.env.RABBITMQ_URL ?? 'amqp://qamart:qamart_pw@rabbitmq:5672';
const RABBIT_API = process.env.RABBITMQ_API ?? 'http://rabbitmq:15672/api';
const rabbitAuth = 'Basic ' + Buffer.from(`${process.env.RABBITMQ_USER ?? 'qamart'}:${process.env.RABBITMQ_PASS ?? 'qamart_pw'}`).toString('base64');

export async function rabbitApi(path: string, init: RequestInit = {}) {
  const res = await fetch(`${RABBIT_API}${path}`, {
    ...init,
    headers: { authorization: rabbitAuth, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok && res.status !== 204) throw new Error(`RabbitMQ API ${path} -> ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Move every message from <queue>.dlq back to <queue>, resetting retry history. */
export async function redriveDlq(queue: string) {
  const conn = await amqp.connect(RABBIT_URL);
  try {
    const ch = await conn.createConfirmChannel();
    let moved = 0;
    for (;;) {
      const msg = await ch.get(`${queue}.dlq`, { noAck: false });
      if (!msg) break;
      const headers = { ...(msg.properties.headers ?? {}) };
      delete headers['x-death'];
      delete headers['x-final-error'];
      ch.sendToQueue(queue, msg.content, { ...msg.properties, headers: { ...headers, 'x-redriven-at': new Date().toISOString() } });
      await ch.waitForConfirms();
      ch.ack(msg);
      moved++;
    }
    await sleep(100);
    return moved;
  } finally {
    await conn.close().catch(() => undefined);
  }
}

/** Call a service's /__lab endpoint. */
export async function labCall(instance: string, method: string, path: string, body?: unknown, timeoutMs = 5000) {
  const res = await fetch(`${instanceUrl(instance)}/__lab${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-lab-token': config.labToken },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error?.message ?? `${instance} ${path} -> ${res.status}`);
  return data;
}
