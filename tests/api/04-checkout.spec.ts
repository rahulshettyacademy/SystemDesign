/** Checkout orchestration: coupons, payments, compensation, SQL data consistency. */
import { expect, test } from '@playwright/test';
import { addToCart, bearer, checkout, expectError, freshShopper } from '../support/api';
import { expectSchema } from '../support/contract';
import { activate, dataset, deactivate, eventually } from '../support/lab';

test.describe('Checkout', () => {
  test('happy path with WELCOME10: order confirmed, totals correct, contract valid', async ({ request }) => {
    const s = await freshShopper(request, 45);
    await addToCart(request, s.token, 'iphone-15-128');
    const res = await checkout(request, s.token, { couponCode: 'WELCOME10' });
    expect(res.status()).toBe(201);
    const order = await res.json();
    expectSchema(order, 'Order');
    expect(order).toMatchObject({ status: 'CONFIRMED', subtotal: 69900, discount: 1000, total: 68900, couponCode: 'WELCOME10' });
    expect(order.events.map((e: any) => e.status)).toEqual(['PENDING', 'PAYMENT_PENDING', 'CONFIRMED']);

    // the cart is emptied ASYNCHRONOUSLY by the cart service (OrderCreated event)
    await eventually(async () => (await (await request.get('/api/cart', { headers: s.headers })).json()).itemCount === 0);
    const history = await (await request.get('/api/orders', { headers: s.headers })).json();
    expectSchema(history, 'OrderList');
    expect(history.items[0].id).toBe(order.id);
  });

  test('coupon rules: expired, minimum subtotal, unknown', async ({ request }) => {
    const s = await freshShopper(request, 45);
    const v = (code: string, subtotal: number) => request.post('/api/coupons/validate', { headers: s.headers, data: { code, subtotal } });
    await expectError(await v('EXPIRED20', 50000), 422, 'COUPON_EXPIRED');
    await expectError(await v('FLAT500', 4999), 422, 'COUPON_MIN_SUBTOTAL');
    await expectError(await v('NOPE', 50000), 422, 'COUPON_INVALID');
    await expectError(await v('DIWALI50', 50000), 422, 'COUPON_INACTIVE'); // sale not active
    const ok = await (await v('flat500', 5000)).json(); // case-insensitive
    expectSchema(ok, 'CouponValidation');
    expect(ok).toMatchObject({ code: 'FLAT500', discount: 500, totalAfterDiscount: 4500 });
  });

  test('an invalid coupon at checkout creates NO order (transaction rolled back)', async ({ request }) => {
    const s = await freshShopper(request, 45);
    await addToCart(request, s.token, 'jbl-flip-6');
    const before = (await (await request.get('/api/orders', { headers: s.headers })).json()).items.length;
    await expectError(await checkout(request, s.token, { couponCode: 'EXPIRED20' }), 422, 'COUPON_EXPIRED');
    const after = (await (await request.get('/api/orders', { headers: s.headers })).json()).items.length;
    expect(after).toBe(before);
  });

  test('checkout validation: missing Idempotency-Key, bad address, empty cart', async ({ request }) => {
    const s = await freshShopper(request, 45);
    await expectError(await checkout(request, s.token), 400, 'CART_EMPTY');
    await addToCart(request, s.token, 'jbl-flip-6');
    const noKey = await request.post('/api/orders', { headers: s.headers, data: { paymentMethod: 'demo_success', shippingAddress: {} } });
    await expectError(noKey, 400, 'IDEMPOTENCY_KEY_REQUIRED');
    const bad = await request.post('/api/orders', {
      headers: { ...s.headers, 'idempotency-key': 'abcdefgh-1234' },
      data: { paymentMethod: 'bitcoin', shippingAddress: { name: 'X', line1: 'here', city: 'B', pincode: '012345', phone: '12345' } },
    });
    const body = await expectError(bad, 400, 'VALIDATION_ERROR');
    const fields = body.error.details.map((d: any) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['paymentMethod', 'shippingAddress.pincode', 'shippingAddress.phone', 'shippingAddress.line1']));
  });

  test('declined payment: 402, order PAYMENT_FAILED, stock and coupon given back (compensation)', async ({ request }) => {
    const s = await freshShopper(request, 46);
    const stockBefore = (await (await request.get('/api/inventory/kindle-paperwhite')).json()).available;
    await addToCart(request, s.token, 'kindle-paperwhite');
    const res = await checkout(request, s.token, { paymentMethod: 'demo_decline', couponCode: 'WELCOME10' });
    const body = await expectError(res, 402, 'PAYMENT_DECLINED');
    expectSchema(body, 'CheckoutFailure');
    expect(body.order.status).toBe('PAYMENT_FAILED');
    const stockAfter = (await (await request.get('/api/inventory/kindle-paperwhite')).json()).available;
    expect(stockAfter).toBe(stockBefore);
    const reservation = (await dataset(request, 'reservations')).find((r) => r.order_id === body.order.id);
    expect(reservation.status).toBe('RELEASED');
    // the cart is kept so the customer can try another payment method
    expect((await (await request.get('/api/cart', { headers: s.headers })).json()).itemCount).toBe(1);
  });

  test('payment service DOWN: 503 PAYMENT_UNAVAILABLE, nothing charged, browsing still works @slow', async ({ request }) => {
    const s = await freshShopper(request, 46);
    await addToCart(request, s.token, 'pixel-8-128');
    await activate(request, 'payment-down');
    let orderId = '';
    try {
      const body = await expectError(await checkout(request, s.token), 503, 'PAYMENT_UNAVAILABLE');
      expect(body.order.status).toBe('PAYMENT_FAILED');
      orderId = body.order.id;
      // partial failure: the rest of the shop works
      expect((await request.get('/api/products?q=pixel')).status()).toBe(200);
      // ...but anything served BY the payment service is unavailable at the gateway
      await expectError(await request.get(`/api/payments?orderId=${orderId}`, { headers: s.headers }), 503, 'SERVICE_UNAVAILABLE');
    } finally {
      await deactivate(request, 'payment-down');
    }
    const payments = await (await request.get(`/api/payments?orderId=${orderId}`, { headers: s.headers })).json();
    expect(payments.items).toHaveLength(0); // the customer was never charged
  });

  test('stale cart price: checkout charges the CURRENT catalog price', async ({ request }) => {
    const s = await freshShopper(request, 47);
    await addToCart(request, s.token, 'mi-tv-43'); // snapshot 24999
    const admin = (await (await request.post('/api/auth/login', { data: { email: 'admin@qamart.test', password: 'Password@123' } })).json()).token;
    await request.patch('/api/products/mi-tv-43', { headers: bearer(admin), data: { price: 23999 } });
    const order = await (await checkout(request, s.token)).json();
    expect(order.total).toBe(23999);
    expect(order.priceChanges).toEqual([{ productId: 'mi-tv-43', cartPrice: 24999, currentPrice: 23999 }]);
    await request.patch('/api/products/mi-tv-43', { headers: bearer(admin), data: { price: 24999 } });
  });
});
