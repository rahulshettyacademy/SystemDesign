import amqp, { Channel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import { randomUUID } from 'node:crypto';
import { config, sleep } from './config';
import { currentContext } from './context';
import { log } from './logger';
import { runInTrace, withSpan } from './tracer';

export const EVENTS_EXCHANGE = 'shop.events';

export interface ConsumerSpec {
  queue: string;
  /** routing keys on shop.events this queue listens to */
  bindings: string[];
  maxAttempts?: number;
  retryDelayMs?: number;
  prefetch?: number;
  handler: (payload: any, meta: MessageMeta) => Promise<void>;
}

export interface MessageMeta {
  messageId: string;
  routingKey: string;
  attempt: number;
  redelivered: boolean;
  headers: Record<string, any>;
}

/**
 * Small RabbitMQ helper.
 * Topology per consumer queue Q (all durable):
 *   shop.events --(binding)--> Q --(reject)--> Q.retry (TTL) --(expire)--> Q
 *   after maxAttempts the consumer publishes the message to Q.dlq and acks it.
 * Reconnects automatically; consumers are re-attached after a broker restart.
 */
export class Rabbit {
  private conn?: Awaited<ReturnType<typeof amqp.connect>>;
  private pub?: ConfirmChannel;
  private sub?: Channel;
  private consumers = new Map<string, { spec: ConsumerSpec; tag?: string; paused: boolean }>();
  private connecting = false;
  connected = false;

  constructor(private url: string) {}

  async connect(): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;
    for (;;) {
      try {
        const conn = await amqp.connect(this.url, { clientProperties: { connection_name: config.instance } });
        conn.on('error', (e) => log.warn('RabbitMQ connection error', { error: e.message }));
        conn.on('close', () => {
          this.connected = false;
          log.warn('RabbitMQ connection closed; reconnecting');
          void this.connect();
        });
        this.conn = conn;
        this.pub = await conn.createConfirmChannel();
        this.sub = await conn.createChannel();
        await this.pub.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
        this.connected = true;
        this.connecting = false;
        log.info('Connected to RabbitMQ');
        for (const c of this.consumers.values()) {
          c.tag = undefined;
          await this.setupConsumer(c.spec.queue);
        }
        return;
      } catch (e) {
        log.warn('RabbitMQ not reachable yet', { error: (e as Error).message });
        await sleep(3000);
      }
    }
  }

  /** Publish with publisher confirms. Throws if the broker is unavailable (callers retry later). */
  async publish(routingKey: string, payload: unknown, opts: { messageId?: string; eventType?: string; traceId?: string } = {}) {
    if (!this.pub || !this.connected) throw new Error('RabbitMQ is not connected');
    const messageId = opts.messageId ?? randomUUID();
    await withSpan(`publish ${routingKey}`, 'producer', { 'messaging.system': 'rabbitmq', exchange: EVENTS_EXCHANGE, routingKey, messageId }, async (span) => {
      const ok = this.pub!.publish(EVENTS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(payload)), {
        persistent: true,
        contentType: 'application/json',
        messageId,
        type: opts.eventType,
        timestamp: Math.floor(Date.now() / 1000),
        headers: { 'x-request-id': opts.traceId ?? currentContext()?.traceId, 'x-parent-span-id': span.spanId },
      });
      if (!ok) log.warn('RabbitMQ publish buffer full');
      await this.pub!.waitForConfirms();
    });
    return messageId;
  }

  async consume(spec: ConsumerSpec) {
    this.consumers.set(spec.queue, { spec, paused: false });
    if (this.connected) await this.setupConsumer(spec.queue);
  }

  isPaused(queue: string) {
    return this.consumers.get(queue)?.paused ?? false;
  }

  /** Stop pulling messages (they wait safely in the queue). */
  async pause(queue: string) {
    const c = this.consumers.get(queue);
    if (!c) return;
    c.paused = true;
    if (c.tag && this.sub) await this.sub.cancel(c.tag);
    c.tag = undefined;
    log.warn('Consumer paused', { queue });
  }

  async resume(queue: string) {
    const c = this.consumers.get(queue);
    if (!c) return;
    c.paused = false;
    await this.setupConsumer(queue);
    log.info('Consumer resumed', { queue });
  }

  private async setupConsumer(queue: string) {
    const c = this.consumers.get(queue)!;
    const ch = this.sub!;
    const retryQueue = `${queue}.retry`;
    const dlq = `${queue}.dlq`;
    await ch.assertQueue(queue, { durable: true, deadLetterExchange: '', deadLetterRoutingKey: retryQueue });
    await ch.assertQueue(retryQueue, {
      durable: true,
      messageTtl: c.spec.retryDelayMs ?? 5000,
      deadLetterExchange: '',
      deadLetterRoutingKey: queue,
    });
    await ch.assertQueue(dlq, { durable: true });
    for (const key of c.spec.bindings) await ch.bindQueue(queue, EVENTS_EXCHANGE, key);
    if (c.paused || c.tag) return;
    await ch.prefetch(c.spec.prefetch ?? 5);
    const { consumerTag } = await ch.consume(queue, (msg) => msg && void this.handle(c.spec, msg));
    c.tag = consumerTag;
  }

  private async handle(spec: ConsumerSpec, msg: ConsumeMessage) {
    const ch = this.sub!;
    const headers = msg.properties.headers ?? {};
    const deaths = (headers['x-death'] as Array<{ queue: string; reason: string; count: number }> | undefined) ?? [];
    const previousFailures = deaths.find((d) => d.queue === spec.queue && d.reason === 'rejected')?.count ?? 0;
    const attempt = previousFailures + 1;
    const maxAttempts = spec.maxAttempts ?? 3;
    const meta: MessageMeta = {
      messageId: msg.properties.messageId,
      routingKey: msg.fields.routingKey,
      attempt,
      redelivered: msg.fields.redelivered,
      headers,
    };
    await runInTrace(headers['x-request-id'], headers['x-parent-span-id'], async () => {
      try {
        await withSpan(`consume ${spec.queue}`, 'consumer', { 'messaging.system': 'rabbitmq', queue: spec.queue, messageId: meta.messageId, attempt, maxAttempts }, async () => {
          const payload = JSON.parse(msg.content.toString());
          await spec.handler(payload, meta);
        });
        ch.ack(msg);
      } catch (err) {
        const reason = (err as Error).message;
        if (attempt >= maxAttempts) {
          log.error('Message failed permanently; moving to dead-letter queue', { queue: spec.queue, messageId: meta.messageId, attempt, reason });
          ch.sendToQueue(`${spec.queue}.dlq`, msg.content, {
            ...msg.properties,
            headers: { ...headers, 'x-final-error': reason, 'x-attempts': attempt, 'x-original-routing-key': meta.routingKey, 'x-dead-lettered-at': new Date().toISOString() },
          });
          ch.ack(msg);
        } else {
          log.warn('Message processing failed; will retry', { queue: spec.queue, messageId: meta.messageId, attempt, maxAttempts, reason, retryInMs: spec.retryDelayMs ?? 5000 });
          ch.nack(msg, false, false);
        }
      }
    });
  }

  async ping() {
    if (!this.connected) throw new Error('RabbitMQ disconnected');
  }

  async close() {
    await this.conn?.close().catch(() => undefined);
  }
}
