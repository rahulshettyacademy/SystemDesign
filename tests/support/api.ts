import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import { ADDRESS, newKey, PASSWORD } from './lab';

export async function login(request: APIRequestContext, user: string): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { email: `${user}@qamart.test`, password: PASSWORD } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).token;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** A logged-in shopper with an empty cart. Uses the loadtestNN accounts so tests don't collide with demos. */
export async function freshShopper(request: APIRequestContext, n: number) {
  const user = `loadtest${String(n).padStart(2, '0')}`;
  const token = await login(request, user);
  await request.delete('/api/cart', { headers: bearer(token) });
  return { user, token, headers: bearer(token) };
}

export async function addToCart(request: APIRequestContext, token: string, productId: string, quantity = 1) {
  const res = await request.post('/api/cart/items', { headers: bearer(token), data: { productId, quantity } });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

export async function checkout(
  request: APIRequestContext,
  token: string,
  opts: { key?: string; paymentMethod?: string; couponCode?: string; timeout?: number } = {},
): Promise<APIResponse> {
  return request.post('/api/orders', {
    headers: { ...bearer(token), 'idempotency-key': opts.key ?? newKey() },
    data: { paymentMethod: opts.paymentMethod ?? 'demo_success', couponCode: opts.couponCode, shippingAddress: ADDRESS },
    timeout: opts.timeout ?? 30_000,
  });
}

/** Assert the standard error envelope and return it. */
export async function expectError(res: APIResponse, status: number, code: string) {
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(status);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  expect(body.error.requestId).toBe(res.headers()['x-request-id']);
  return body;
}
