import { randomUUID } from 'node:crypto';
import { callService, Db, log, Query } from '@qamart/common';
import { releaseCoupon } from './coupons';

export const INVENTORY_URL = process.env.INVENTORY_URL ?? 'http://inventory:3000';

export async function loadOrder(q: Query, id: string) {
  const { rows } = await q('SELECT * FROM orders WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const [items, events] = await Promise.all([
    q('SELECT * FROM order_items WHERE order_id = $1 ORDER BY product_id', [id]),
    q('SELECT status, note, created_at FROM order_events WHERE order_id = $1 ORDER BY id', [id]),
  ]);
  return toView(rows[0], items.rows, events.rows);
}

export function toView(o: any, items: any[] = [], events: any[] = []) {
  return {
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    items: items.map((i) => ({ productId: i.product_id, name: i.name, unitPrice: i.unit_price, quantity: i.quantity, lineTotal: i.line_total })),
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    couponCode: o.coupon_code,
    paymentMethod: o.payment_method,
    paymentId: o.payment_id,
    failure: o.failure_code ? { code: o.failure_code, reason: o.failure_reason } : null,
    shippingAddress: o.shipping_address,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    events: events.map((e) => ({ status: e.status, note: e.note, at: e.created_at })),
  };
}

export const addEvent = (q: Query, orderId: string, status: string, note: string) =>
  q('INSERT INTO order_events (order_id, status, note) VALUES ($1, $2, $3)', [orderId, status, note]);

/**
 * PAYMENT_PENDING -> CONFIRMED, and write the OrderCreated event to the outbox
 * in the SAME transaction. Safe to call twice (sync path and reconciler): the
 * status guard means only one caller wins.
 */
export async function confirmOrder(db: Db, orderId: string, paymentId: string, note: string) {
  return db.tx(async (q) => {
    const { rows } = await q(
      `UPDATE orders SET status = 'CONFIRMED', payment_id = $2, updated_at = now()
        WHERE id = $1 AND status IN ('PENDING','PAYMENT_PENDING') RETURNING *`,
      [orderId, paymentId],
    );
    const o = rows[0];
    if (!o) return false;
    await addEvent(q, orderId, 'CONFIRMED', note);
    const items = await q('SELECT product_id, name, unit_price, quantity FROM order_items WHERE order_id = $1', [orderId]);
    const eventId = randomUUID();
    const payload = {
      eventId,
      eventType: 'OrderCreated',
      occurredAt: new Date().toISOString(),
      orderId: o.id,
      orderNumber: o.order_number,
      userId: o.user_id,
      customer: { email: o.user_email, name: o.user_name },
      items: items.rows.map((i) => ({ productId: i.product_id, name: i.name, unitPrice: i.unit_price, quantity: i.quantity })),
      total: o.total,
      currency: 'INR',
    };
    await q(
      `INSERT INTO outbox (event_id, event_type, routing_key, payload, trace_id) VALUES ($1, 'OrderCreated', 'order.created', $2, $3)`,
      [eventId, JSON.stringify(payload), o.trace_id],
    );
    log.info('Order CONFIRMED; OrderCreated event stored in outbox', { orderId, orderNumber: o.order_number, eventId });
    return true;
  });
}

/** Moves an order to a failed state, gives the coupon back and releases reserved stock. */
export async function failOrder(db: Db, orderId: string, status: 'PAYMENT_FAILED' | 'REJECTED', code: string, reason: string, releaseStock = true) {
  const changed = await db.tx(async (q) => {
    const r = await q(
      `UPDATE orders SET status = $2, failure_code = $3, failure_reason = $4, updated_at = now()
        WHERE id = $1 AND status IN ('PENDING','PAYMENT_PENDING') RETURNING id`,
      [orderId, status, code, reason],
    );
    if (!r.rowCount) return false;
    await addEvent(q, orderId, status, reason);
    await releaseCoupon(q, orderId);
    return true;
  });
  if (changed && releaseStock) {
    try {
      await callService('inventory', `${INVENTORY_URL}/internal/reservations/${orderId}/release`, { method: 'POST', timeoutMs: 2000 });
    } catch (e) {
      log.warn('Could not release reservation now; inventory sweeper will release it later', { orderId, error: (e as Error).message });
    }
  }
  if (changed) log.warn(`Order ${status}`, { orderId, code, reason });
  return changed;
}
