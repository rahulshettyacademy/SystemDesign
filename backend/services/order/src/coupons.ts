import { ApiError, Query } from '@qamart/common';

export interface CouponResult {
  code: string;
  description: string;
  discount: number;
}

/** Validates a coupon against a subtotal. Throws 422 with a specific code for each rule. */
export async function evaluateCoupon(q: Query, rawCode: string, subtotal: number, userId: string, lock = false): Promise<CouponResult> {
  const code = rawCode.trim().toUpperCase();
  const { rows } = await q(`SELECT * FROM coupons WHERE code = $1 ${lock ? 'FOR UPDATE' : ''}`, [code]);
  const c = rows[0];
  const fail = (errCode: string, msg: string): never => {
    throw new ApiError(422, errCode, msg, { code });
  };
  if (!c) fail('COUPON_INVALID', `Coupon ${code} does not exist`);
  if (!c.active) fail('COUPON_INACTIVE', c.sale_only ? `${code} is only valid during the Diwali sale` : `${code} is not active`);
  if (c.valid_until && new Date(c.valid_until) < new Date()) fail('COUPON_EXPIRED', `${code} expired on ${new Date(c.valid_until).toDateString()}`);
  if (subtotal < c.min_subtotal) fail('COUPON_MIN_SUBTOTAL', `${code} needs a minimum order of ₹${c.min_subtotal}`);
  if (c.usage_limit !== null && c.used_count >= c.usage_limit) fail('COUPON_EXHAUSTED', `${code} has been fully redeemed`);
  if (c.per_user_limit !== null) {
    const used = await q('SELECT count(*)::int AS n FROM coupon_redemptions WHERE coupon_code = $1 AND user_id = $2', [code, userId]);
    if (used.rows[0].n >= c.per_user_limit) fail('COUPON_ALREADY_USED', `You have already used ${code}`);
  }
  const discount = c.type === 'PERCENT' ? Math.min(Math.floor((subtotal * c.value) / 100), c.max_discount ?? Infinity) : Math.min(c.value, subtotal);
  return { code, description: c.description, discount };
}

/** Called inside the order transaction: the row lock makes usage limits safe under concurrency. */
export async function redeemCoupon(q: Query, code: string, subtotal: number, userId: string, orderId: string) {
  const result = await evaluateCoupon(q, code, subtotal, userId, true);
  await q('UPDATE coupons SET used_count = used_count + 1 WHERE code = $1', [result.code]);
  await q('INSERT INTO coupon_redemptions (order_id, coupon_code, user_id) VALUES ($1, $2, $3)', [orderId, result.code, userId]);
  return result;
}

export async function releaseCoupon(q: Query, orderId: string) {
  const r = await q('DELETE FROM coupon_redemptions WHERE order_id = $1 RETURNING coupon_code', [orderId]);
  if (r.rows[0]) await q('UPDATE coupons SET used_count = used_count - 1 WHERE code = $1', [r.rows[0].coupon_code]);
}
