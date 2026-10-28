/**
 * CHECKOUT ORCHESTRATION (synchronous part of the customer journey)
 *
 *  1. Idempotency check (same Idempotency-Key => same order, never a second one)
 *  2. Read cart                (cart service)
 *  3. Re-price items           (product service, straight from the DB - never trust cached/client prices)
 *  4. Create order + coupon    (one SQL transaction)
 *  5. Reserve stock            (inventory service)
 *  6. Charge                   (payment service, retried with the SAME payment idempotency key)
 *  7. Confirm + outbox event   (one SQL transaction) -> async consumers do the rest
 */
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@qamart/common';
import { ApiError, callService, Db, log, sleep, UpstreamError, withSpan } from '@qamart/common';
import { redeemCoupon } from './coupons';
import { addEvent, confirmOrder, failOrder, INVENTORY_URL, loadOrder } from './orders';

const CART_URL = process.env.CART_URL ?? 'http://cart:3000';
const PRODUCT_URL = process.env.PRODUCT_URL ?? 'http://nginx:8090';
const PAYMENT_URL = process.env.PAYMENT_URL ?? 'http://payment:3000';
export const PAYMENT_TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS ?? 3000);
export const PAYMENT_MAX_ATTEMPTS = 3;

export interface CheckoutInput {
  idempotencyKey: string;
  couponCode?: string;
  paymentMethod: 'demo_success' | 'demo_decline' | 'demo_slow';
  shippingAddress: Record<string, string>;
}

export type CheckoutOutcome = { httpStatus: number; replayed: boolean; order: any; error?: { code: string; message: string; details?: unknown } };

export const paymentKeyFor = (orderId: string) => `pay_${orderId}`;

export async function checkout(db: Db, user: AuthUser, input: CheckoutInput, traceId: string): Promise<CheckoutOutcome> {
  // 1. Idempotency ------------------------------------------------------------
  const prior = await db.query('SELECT id, status FROM orders WHERE user_id = $1 AND idempotency_key = $2', [user.id, input.idempotencyKey]);
  if (prior.rows[0]) {
    log.info('Idempotent replay: this checkout was already submitted', { orderId: prior.rows[0].id, status: prior.rows[0].status });
    return { httpStatus: 200, replayed: true, order: await loadOrder(db.query, prior.rows[0].id) };
  }

  // 2. Cart -----------------------------------------------------------------
  let cart: { items: Array<{ productId: string; quantity: number; unitPrice: number }> };
  try {
    cart = (await callService('cart', `${CART_URL}/internal/carts/${user.id}`, { timeoutMs: 2000 })).data;
  } catch (e) {
    if (e instanceof UpstreamError) throw new ApiError(503, 'CART_UNAVAILABLE', 'Cart service is unavailable; nothing was charged. Please retry.');
    throw e;
  }
  if (!cart.items.length) throw new ApiError(400, 'CART_EMPTY', 'Your cart is empty');

  // 3. Authoritative prices ---------------------------------------------------
  let catalog: Array<{ id: string; name: string; price: number }>;
  try {
    const ids = cart.items.map((i) => i.productId).join(',');
    catalog = (await callService('product', `${PRODUCT_URL}/internal/products?ids=${ids}`, { timeoutMs: 2000 })).data.items;
  } catch (e) {
    if (e instanceof UpstreamError) throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Product service is unavailable; nothing was charged. Please retry.');
    throw e;
  }
  const items = cart.items.map((ci) => {
    const p = catalog.find((c) => c.id === ci.productId);
    if (!p) throw new ApiError(409, 'PRODUCT_UNAVAILABLE', `${ci.productId} is no longer sold`);
    return { productId: p.id, name: p.name, unitPrice: p.price, quantity: ci.quantity, lineTotal: p.price * ci.quantity, cartPrice: ci.unitPrice };
  });
  const priceChanges = items.filter((i) => i.cartPrice !== i.unitPrice).map((i) => ({ productId: i.productId, cartPrice: i.cartPrice, currentPrice: i.unitPrice }));
  if (priceChanges.length) log.warn('Prices changed since items were added to cart; charging current prices', { priceChanges });
  const subtotal = items.reduce((n, i) => n + i.lineTotal, 0);

  // 4. Create order (+ redeem coupon) in ONE transaction -----------------------
  const orderId = randomUUID();
  try {
    await db.tx(async (q) => {
      const num = await q(`SELECT 'QM-' || nextval('order_number_seq') AS n`);
      let discount = 0;
      let couponCode: string | null = null;
      // Insert first so the coupon redemption can reference the order (foreign key).
      await q(
        `INSERT INTO orders (id, order_number, user_id, user_email, user_name, idempotency_key, status, subtotal, discount, total, payment_method, shipping_address, trace_id)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,0,$7,$8,$9,$10)`,
        [orderId, num.rows[0].n, user.id, user.email, user.name, input.idempotencyKey, subtotal, input.paymentMethod, JSON.stringify(input.shippingAddress), traceId],
      );
      if (input.couponCode) {
        const c = await redeemCoupon(q, input.couponCode, subtotal, user.id, orderId);
        discount = c.discount;
        couponCode = c.code;
        await q('UPDATE orders SET discount = $2, total = $3, coupon_code = $4 WHERE id = $1', [orderId, discount, subtotal - discount, couponCode]);
      }
      for (const i of items) {
        await q('INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, line_total) VALUES ($1,$2,$3,$4,$5,$6)', [orderId, i.productId, i.name, i.unitPrice, i.quantity, i.lineTotal]);
      }
      await addEvent(q, orderId, 'PENDING', couponCode ? `Order created with coupon ${couponCode} (-₹${discount})` : 'Order created');
    });
  } catch (e: any) {
    if (e?.code === '23505' && String(e?.constraint).includes('idempotency')) {
      // Two identical requests raced; the other one created the order first.
      const other = await db.query('SELECT id, status FROM orders WHERE user_id = $1 AND idempotency_key = $2', [user.id, input.idempotencyKey]);
      log.warn('Concurrent duplicate checkout detected (unique constraint)', { orderId: other.rows[0]?.id });
      throw new ApiError(409, 'REQUEST_IN_PROGRESS', 'An identical checkout request is already being processed', { orderId: other.rows[0]?.id });
    }
    throw e;
  }
  log.info('Order created', { orderId, subtotal, items: items.length });

  // 5. Reserve stock ------------------------------------------------------------
  try {
    await callService('inventory', `${INVENTORY_URL}/internal/reservations`, {
      method: 'POST',
      timeoutMs: 3000,
      body: { orderId, items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })) },
    });
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 409) {
      await failOrder(db, orderId, 'REJECTED', 'OUT_OF_STOCK', e.message, false);
      return { httpStatus: 409, replayed: false, order: await loadOrder(db.query, orderId), error: { code: 'OUT_OF_STOCK', message: e.message, details: e.body?.error?.details } };
    }
    const msg = e instanceof UpstreamError ? e.message : 'Inventory check failed';
    await failOrder(db, orderId, 'REJECTED', 'INVENTORY_UNAVAILABLE', `Could not reserve stock: ${msg}`);
    return { httpStatus: 503, replayed: false, order: await loadOrder(db.query, orderId), error: { code: 'INVENTORY_UNAVAILABLE', message: 'Inventory service is unavailable; nothing was charged. Please retry.' } };
  }
  await db.query(`UPDATE orders SET status = 'PAYMENT_PENDING', updated_at = now() WHERE id = $1`, [orderId]);
  await addEvent(db.query, orderId, 'PAYMENT_PENDING', 'Stock reserved; requesting payment');

  // 6. Charge (with safe retries) --------------------------------------------
  const order = (await db.query('SELECT total FROM orders WHERE id = $1', [orderId])).rows[0];
  const result = await chargeWithRetry({ orderId, userId: user.id, amount: order.total, method: input.paymentMethod });

  // 7. Outcome --------------------------------------------------------------
  if (result.kind === 'succeeded') {
    await confirmOrder(db, orderId, result.payment.paymentId, `Payment ${result.payment.paymentId.slice(0, 8)} succeeded${result.attempts > 1 ? ` after ${result.attempts} attempts (no duplicate charge)` : ''}`);
    const view = await loadOrder(db.query, orderId);
    return { httpStatus: 201, replayed: false, order: { ...view, priceChanges } };
  }
  if (result.kind === 'declined') {
    await failOrder(db, orderId, 'PAYMENT_FAILED', 'PAYMENT_DECLINED', result.reason);
    return { httpStatus: 402, replayed: false, order: await loadOrder(db.query, orderId), error: { code: 'PAYMENT_DECLINED', message: result.reason } };
  }
  if (result.kind === 'not_charged') {
    await failOrder(db, orderId, 'PAYMENT_FAILED', 'PAYMENT_UNAVAILABLE', `Payment service unavailable: ${result.reason}. You were not charged.`);
    return { httpStatus: 503, replayed: false, order: await loadOrder(db.query, orderId), error: { code: 'PAYMENT_UNAVAILABLE', message: 'Payment service is unavailable. You were NOT charged; please try again.' } };
  }
  // unknown outcome: keep stock reserved, let the reconciler find out what happened
  await db.query('UPDATE orders SET updated_at = now() WHERE id = $1', [orderId]);
  await addEvent(db.query, orderId, 'PAYMENT_PENDING', 'Payment outcome unknown (timeout). Reconciliation scheduled - you will not be charged twice.');
  log.warn('Payment outcome UNKNOWN; order left in PAYMENT_PENDING for the reconciler', { orderId });
  return {
    httpStatus: 202,
    replayed: false,
    order: await loadOrder(db.query, orderId),
    error: { code: 'PAYMENT_PENDING', message: 'We are confirming your payment. Your order will update shortly and you will not be charged twice.' },
  };
}

type ChargeResult =
  | { kind: 'succeeded'; payment: any; attempts: number }
  | { kind: 'declined'; reason: string }
  | { kind: 'not_charged'; reason: string }
  | { kind: 'unknown'; reason: string };

/**
 * Retries are only safe because every attempt carries the SAME idempotency key.
 * A timeout means "we don't know if the customer was charged" - so we never
 * conclude "not charged" after a timeout.
 */
async function chargeWithRetry(p: { orderId: string; userId: string; amount: number; method: string }): Promise<ChargeResult> {
  const idempotencyKey = paymentKeyFor(p.orderId);
  let outcomeUnknown = false;
  let lastReason = '';
  for (let attempt = 1; attempt <= PAYMENT_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await withSpan(`payment attempt ${attempt}/${PAYMENT_MAX_ATTEMPTS}`, 'internal', { idempotencyKey, attempt }, () =>
        callService('payment', `${PAYMENT_URL}/internal/payments`, {
          method: 'POST',
          timeoutMs: PAYMENT_TIMEOUT_MS,
          body: { idempotencyKey, orderId: p.orderId, userId: p.userId, amount: p.amount, method: p.method },
        }),
      );
      const payment = res.data;
      if (payment.status === 'SUCCEEDED') {
        if (payment.replayed) log.info('Payment service returned the ORIGINAL charge for this key (no double charge)', { paymentId: payment.paymentId, attempt });
        return { kind: 'succeeded', payment, attempts: attempt };
      }
      return { kind: 'declined', reason: payment.declineReason ?? 'Payment declined' };
    } catch (e) {
      if (!(e instanceof UpstreamError)) throw e;
      lastReason = e.message;
      if (e.kind === 'timeout') {
        outcomeUnknown = true;
        log.warn(`Payment attempt ${attempt} TIMED OUT - outcome unknown; retrying with the SAME idempotency key`, { idempotencyKey });
      } else if (e.kind === 'unavailable') {
        log.warn(`Payment attempt ${attempt}: service unreachable`, { reason: e.message });
      } else if (e.status === 409) {
        outcomeUnknown = true;
        log.info('Original payment still processing; waiting', { attempt });
      } else if (e.status === 503) {
        log.warn(`Payment attempt ${attempt}: service returned 503`, { reason: e.message });
      } else if ((e.status ?? 0) >= 500) {
        outcomeUnknown = true;
        log.warn(`Payment attempt ${attempt}: server error ${e.status} (outcome unknown)`);
      } else {
        return { kind: 'declined', reason: e.message };
      }
      if (attempt < PAYMENT_MAX_ATTEMPTS) await sleep(300 * 3 ** (attempt - 1)); // 300ms, 900ms backoff
    }
  }
  return outcomeUnknown ? { kind: 'unknown', reason: lastReason } : { kind: 'not_charged', reason: lastReason };
}
