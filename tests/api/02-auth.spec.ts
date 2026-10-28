/** Authentication (who are you?) and authorization (what may you do?). */
import { expect, test } from '@playwright/test';
import { addToCart, bearer, checkout, expectError, freshShopper, login } from '../support/api';
import { expectSchema } from '../support/contract';

test.describe('Authentication & authorization', () => {
  test('valid login returns a JWT and the user', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { email: 'alice@qamart.test', password: 'Password@123' } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expectSchema(body, 'LoginResponse');
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.user).toMatchObject({ email: 'alice@qamart.test', role: 'customer' });
  });

  test('wrong password and unknown user give the SAME 401 (no account enumeration)', async ({ request }) => {
    const a = await expectError(await request.post('/api/auth/login', { data: { email: 'alice@qamart.test', password: 'wrong' } }), 401, 'INVALID_CREDENTIALS');
    const b = await expectError(await request.post('/api/auth/login', { data: { email: 'nobody@qamart.test', password: 'wrong' } }), 401, 'INVALID_CREDENTIALS');
    expect(a.error.message).toBe(b.error.message);
  });

  test('malformed login body returns 400 with field details', async ({ request }) => {
    const body = await expectError(await request.post('/api/auth/login', { data: { email: 'not-an-email' } }), 400, 'VALIDATION_ERROR');
    expect(body.error.details.map((d: any) => d.field).sort()).toEqual(['email', 'password']);
  });

  test('invalid JSON returns 400 INVALID_JSON', async ({ request }) => {
    const res = await request.post('/api/auth/login', { headers: { 'content-type': 'application/json' }, data: '{"email": ' });
    await expectError(res, 400, 'INVALID_JSON');
  });

  test('protected endpoints require a token', async ({ request }) => {
    await expectError(await request.get('/api/cart'), 401, 'AUTH_REQUIRED');
    await expectError(await request.get('/api/orders'), 401, 'AUTH_REQUIRED');
    await expectError(await request.get('/api/cart', { headers: { authorization: 'Bearer abc.def.ghi' } }), 401, 'TOKEN_INVALID');
  });

  test('a customer cannot change product prices (403), an admin can', async ({ request }) => {
    const alice = await login(request, 'alice');
    await expectError(await request.patch('/api/products/jbl-flip-6', { headers: bearer(alice), data: { price: 1 } }), 403, 'FORBIDDEN');
    const admin = await login(request, 'admin');
    const res = await request.patch('/api/products/jbl-flip-6', { headers: bearer(admin), data: { price: 9999 } });
    expect(res.status()).toBe(200);
    expectSchema(await res.json(), 'ProductUpdateResult');
  });

  test("one customer cannot read another customer's order (404, not 403)", async ({ request }) => {
    const shopper = await freshShopper(request, 41);
    await addToCart(request, shopper.token, 'diya-set-12');
    const order = await (await checkout(request, shopper.token)).json();
    const bob = await login(request, 'bob');
    await expectError(await request.get(`/api/orders/${order.id}`, { headers: bearer(bob) }), 404, 'ORDER_NOT_FOUND');
    const own = await request.get(`/api/orders/${order.id}`, { headers: shopper.headers });
    expect(own.status()).toBe(200);
    const payments = await (await request.get(`/api/payments?orderId=${order.id}`, { headers: bearer(bob) })).json();
    expect(payments.items).toHaveLength(0);
  });
});
