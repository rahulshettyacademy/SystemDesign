/**
 * The course's continuous customer journey, end to end in a real browser:
 * search -> product -> stock -> cart -> coupon -> checkout -> payment -> confirmation -> history.
 */
import { expect, test } from '@playwright/test';
import { PASSWORD } from '../support/lab';

test('customer buys an iPhone with a coupon and receives a confirmation', async ({ page, request }) => {
  // make sure the cart starts empty for this user
  const token = (await (await request.post('/api/auth/login', { data: { email: 'carol@qamart.test', password: PASSWORD } })).json()).token;
  await request.delete('/api/cart', { headers: { authorization: `Bearer ${token}` } });

  await page.goto('/');
  await page.getByTestId('search-input').fill('iphone');
  await page.getByTestId('search-button').click();
  await expect(page.getByTestId('results-summary')).toContainText('2 results for "iphone"');

  // watch the real HTTP call the browser makes (same as DevTools -> Network)
  const productResponse = page.waitForResponse((r) => r.url().endsWith('/api/products/iphone-15-128') && r.request().method() === 'GET');
  await page.locator('[data-product-id="iphone-15-128"]').click();
  const resp = await productResponse;
  expect(resp.status()).toBe(200);
  expect(resp.headers()['x-request-id']).toBeTruthy();
  await expect(page.getByTestId('product-title')).toHaveText('Apple iPhone 15 (128 GB) - Black');
  await expect(page.getByTestId('stock-status')).toHaveText('In stock');

  // not logged in yet: Add to Cart sends us to login and back
  await page.getByTestId('add-to-cart').click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByTestId('login-email').fill('carol@qamart.test');
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/product\/iphone-15-128/);
  await page.getByTestId('add-to-cart').click();
  await expect(page.getByTestId('added-to-cart')).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveText('1');

  await page.getByTestId('nav-cart').click();
  await expect(page.getByTestId('cart-subtotal')).toHaveText('₹69,900');
  await page.getByTestId('coupon-input').fill('WELCOME10');
  await page.getByTestId('apply-coupon').click();
  await expect(page.getByTestId('coupon-applied')).toContainText('WELCOME10');
  await expect(page.getByTestId('cart-total')).toHaveText('₹68,900');

  await page.getByTestId('proceed-to-checkout').click();
  await expect(page.getByTestId('checkout-total')).toHaveText('₹68,900');
  const orderRequest = page.waitForRequest((r) => r.url().endsWith('/api/orders') && r.method() === 'POST');
  await page.getByTestId('place-order').click();
  const sent = await orderRequest;
  expect(sent.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);

  await expect(page.getByTestId('order-confirmation')).toBeVisible();
  await expect(page.getByTestId('order-status')).toHaveText('Confirmed');
  await expect(page.getByTestId('order-total')).toHaveText('₹68,900');
  // the e-mail is produced asynchronously by the notification service; the page polls for it
  await expect(page.getByTestId('notification-sent')).toBeVisible({ timeout: 15_000 });

  const orderNumber = await page.getByTestId('order-number').textContent();
  await page.getByTestId('nav-orders').click();
  await expect(page.locator(`[data-order-number="${orderNumber}"]`)).toBeVisible();
});
