/** DEMO 6 - Messaging: async processing, consumer down, retries, DLQ, duplicates, idempotent consumers. */
import { expect, test } from '@playwright/test';
import { addToCart, checkout, freshShopper } from '../support/api';
import { expectSchema } from '../support/contract';
import { activate, deactivate, eventually, lab } from '../support/lab';

const notificationsFor = async (request: any, headers: any, orderId: string) =>
  (await (await request.get(`/api/notifications?orderId=${orderId}`, { headers })).json()).items as any[];
const queue = async (request: any, name: string) => (await lab(request, 'GET', '/queues')).queues.find((q: any) => q.name === name);

test.describe('Order events & notifications', () => {
  test('OrderCreated produces exactly one confirmation notification, asynchronously', async ({ request }) => {
    const s = await freshShopper(request, 21);
    await addToCart(request, s.token, 'diya-set-12');
    const order = await (await checkout(request, s.token)).json();
    const notes = await eventually(async () => {
      const n = await notificationsFor(request, s.headers, order.id);
      return n.length > 0 && n;
    });
    expectSchema({ items: notes }, 'NotificationList');
    expect(notes).toHaveLength(1);
    expect(notes[0].subject).toContain(order.orderNumber);
  });

  test('consumer stopped: order still confirmed, message waits in the queue, delivered after restart @slow', async ({ request }) => {
    const s = await freshShopper(request, 22);
    await addToCart(request, s.token, 'diya-set-12');
    await activate(request, 'notification-paused');
    let orderId = '';
    try {
      const res = await checkout(request, s.token);
      expect(res.status()).toBe(201); // the synchronous part does not care
      orderId = (await res.json()).id;
      await eventually(async () => (await queue(request, 'notification.order-created'))?.ready >= 1, 10_000);
      expect(await notificationsFor(request, s.headers, orderId)).toHaveLength(0);
    } finally {
      await deactivate(request, 'notification-paused');
    }
    await eventually(async () => (await notificationsFor(request, s.headers, orderId)).length === 1);
  });

  test('duplicate delivery is ignored by the idempotent consumer', async ({ request }) => {
    const s = await freshShopper(request, 23);
    await addToCart(request, s.token, 'diya-set-12');
    await activate(request, 'duplicate-delivery');
    let order: any;
    try {
      order = await (await checkout(request, s.token)).json();
      await eventually(async () => (await notificationsFor(request, s.headers, order.id)).length >= 1);
    } finally {
      await deactivate(request, 'duplicate-delivery');
    }
    // Observability: the consumer logged that it saw (and ignored) the second copy.
    await eventually(async () => {
      const logs = (await lab(request, 'GET', `/logs?service=notification&q=${order.orderNumber}`)).items;
      return logs.some((l: any) => l.msg.startsWith('Duplicate'));
    });
    expect(await notificationsFor(request, s.headers, order.id)).toHaveLength(1);
  });

  test('failing consumer: 3 attempts then dead-letter queue; re-drive after the fix @slow', async ({ request }) => {
    test.setTimeout(90_000);
    const s = await freshShopper(request, 24);
    await addToCart(request, s.token, 'diya-set-12');
    await lab(request, 'POST', '/queues/notification.order-created.dlq/purge');
    await activate(request, 'notification-failing');
    let orderId = '';
    try {
      orderId = (await (await checkout(request, s.token)).json()).id;
      // attempt 1 now, attempt 2 after ~5s, attempt 3 after ~10s, then DLQ
      await eventually(async () => (await queue(request, 'notification.order-created.dlq'))?.ready === 1, 30_000, 1000);
      expect(await notificationsFor(request, s.headers, orderId)).toHaveLength(0);
      const peek = await lab(request, 'GET', '/queues/notification.order-created.dlq/peek');
      expect(peek.items[0].properties.headers['x-attempts']).toBe(3);
      expect(peek.items[0].payload.orderId).toBe(orderId);
    } finally {
      await deactivate(request, 'notification-failing');
    }
    const moved = await lab(request, 'POST', '/queues/notification.order-created.dlq/redrive');
    expect(moved.moved).toBe(1);
    await eventually(async () => (await notificationsFor(request, s.headers, orderId)).length === 1);
  });

  test('broker down: orders still confirmed via the transactional outbox, events delivered later @slow', async ({ request }) => {
    test.setTimeout(120_000);
    const s = await freshShopper(request, 25);
    await addToCart(request, s.token, 'diya-set-12');
    await activate(request, 'rabbitmq-down');
    let orderId = '';
    try {
      const res = await checkout(request, s.token);
      expect(res.status()).toBe(201);
      orderId = (await res.json()).id;
      const outbox = (await lab(request, 'GET', '/data/outbox')).rows.find((r: any) => r.event_id && r.published_at === null);
      expect(outbox).toBeTruthy();
    } finally {
      await deactivate(request, 'rabbitmq-down');
    }
    await eventually(async () => (await notificationsFor(request, s.headers, orderId)).length === 1, 60_000, 2000);
  });
});
