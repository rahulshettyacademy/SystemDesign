/**
 * NOTIFICATION SERVICE — an asynchronous CONSUMER of OrderCreated events.
 * Stores "sent" confirmation messages in MongoDB (notification_db). No real emails are sent.
 *
 * Shows: at-least-once delivery, retries with delay, dead-letter queue,
 * and IDEMPOTENT processing (a duplicate event never creates a second notification).
 */
import { MongoClient } from 'mongodb';
import {
  config, createService, Faults, log, Rabbit, requireAuth, requiredEnv, sleep, validate, withSpan, z,
} from '@qamart/common';

const QUEUE = 'notification.order-created';
const mongo = new MongoClient(requiredEnv('MONGO_URL'), { serverSelectionTimeoutMS: 3000 });
const notifications = mongo.db('notification_db').collection('notifications');
const rabbit = new Rabbit(requiredEnv('RABBITMQ_URL'));
const svc = createService();
const { app } = svc;
const stats = { processed: 0, duplicatesIgnored: 0, failedAttempts: 0, deadLettered: 0 };

const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

async function handleOrderCreated(event: any, meta: { messageId: string; attempt: number }) {
  const eventId = event.eventId ?? meta.messageId;

  // 1. Idempotency check: have we already handled this exact event?
  const existing = await withSpan('MongoDB findOne', 'db', { 'db.system': 'mongodb', collection: 'notifications', filter: `{eventId:"${eventId}"}` }, () =>
    notifications.findOne({ eventId }),
  );
  if (existing) {
    stats.duplicatesIgnored++;
    log.warn('Duplicate OrderCreated event ignored (already notified)', { eventId, orderNumber: event.orderNumber });
    return;
  }

  // 2. Simulated slowness / failure of the e-mail provider
  const delay = Number(Faults.get('notification.processingDelayMs', 0));
  if (delay > 0) {
    log.info(`Simulating slow e-mail provider (${delay}ms)`);
    await sleep(delay);
  }
  if (Faults.get('notification.failProcessing', false)) {
    stats.failedAttempts++;
    if (meta.attempt >= 3) stats.deadLettered++;
    throw new Error('E-mail provider unavailable (injected fault)');
  }

  // 3. "Send" and record. The unique index on eventId is the final guard against races.
  const doc = {
    eventId,
    userId: event.userId,
    orderId: event.orderId,
    orderNumber: event.orderNumber,
    type: 'ORDER_CONFIRMATION',
    channel: 'email (simulated)',
    to: event.customer?.email,
    subject: `Your QAMart order ${event.orderNumber} is confirmed`,
    body: `Hi ${event.customer?.name ?? 'there'}, thank you for shopping with QAMart! We have received your payment of ${fmt(event.total)} for ${event.items.length} item(s): ${event.items.map((i: any) => `${i.name} x${i.quantity}`).join(', ')}.`,
    attempts: meta.attempt,
    status: 'SENT',
    createdAt: new Date(),
    eventOccurredAt: event.occurredAt,
  };
  try {
    await withSpan('MongoDB insertOne', 'db', { 'db.system': 'mongodb', collection: 'notifications' }, () => notifications.insertOne(doc));
  } catch (e: any) {
    if (e?.code === 11000) {
      stats.duplicatesIgnored++;
      log.warn('Duplicate event lost the race (unique index) - ignored', { eventId });
      return;
    }
    throw e;
  }
  stats.processed++;
  const lagMs = Date.now() - new Date(event.occurredAt).getTime();
  log.info('Order confirmation notification sent', { orderNumber: event.orderNumber, to: doc.to, attempt: meta.attempt, lagMs });
}

app.get('/api/notifications', requireAuth, async (req, res) => {
  const orderId = req.query.orderId ? validate(z.string().uuid('must be a valid order id'), req.query.orderId, 'orderId') : undefined;
  const filter: Record<string, unknown> = { userId: req.user!.id };
  if (orderId) filter.orderId = orderId;
  const docs = await withSpan('MongoDB find', 'db', { 'db.system': 'mongodb', collection: 'notifications', filter: JSON.stringify(filter) }, () =>
    notifications.find(filter).sort({ createdAt: -1 }).limit(50).toArray(),
  );
  res.json({
    items: docs.map((d) => ({
      id: String(d._id), orderId: d.orderId, orderNumber: d.orderNumber, type: d.type, channel: d.channel, subject: d.subject, body: d.body, status: d.status, attempts: d.attempts, createdAt: d.createdAt,
    })),
  });
});

svc.healthCheck('mongodb', () => mongo.db('notification_db').command({ ping: 1 }));
svc.healthCheck('rabbitmq', () => rabbit.ping());
svc.setLabInfo(() => ({ consumer: { queue: QUEUE, paused: rabbit.isPaused(QUEUE) }, stats }));
svc.labAction('pause-consumer', async () => {
  await rabbit.pause(QUEUE);
  return { paused: true };
});
svc.labAction('resume-consumer', async () => {
  await rabbit.resume(QUEUE);
  return { paused: false };
});
svc.onLabReset(async () => {
  await notifications.deleteMany({});
  Object.assign(stats, { processed: 0, duplicatesIgnored: 0, failedAttempts: 0, deadLettered: 0 });
  if (rabbit.isPaused(QUEUE)) await rabbit.resume(QUEUE);
});

(async () => {
  for (;;) {
    try {
      await mongo.connect();
      break;
    } catch (e) {
      log.warn('Waiting for MongoDB...', { error: (e as Error).message });
      await sleep(2000);
    }
  }
  await notifications.createIndex({ eventId: 1 }, { unique: true });
  await notifications.createIndex({ userId: 1, createdAt: -1 });
  await rabbit.consume({ queue: QUEUE, bindings: ['order.created'], maxAttempts: 3, retryDelayMs: 5000, handler: handleOrderCreated });
  void rabbit.connect();
  await svc.start();
  log.info('Notification consumer ready', { queue: QUEUE, instance: config.instance });
})();
