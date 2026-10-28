/** Frontend validation, error messages and edge cases. */
import { expect, test } from '@playwright/test';
import { PASSWORD } from '../support/lab';

async function loginAs(page: any, email: string) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('logout')).toBeVisible();
}

test('wrong password shows a generic error message', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill('alice@qamart.test');
  await page.getByTestId('login-password').fill('not-the-password');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toHaveText('Email or password is incorrect');
});

test('search with no results shows an empty state', async ({ page }) => {
  await page.goto('/search?q=flying-car');
  await expect(page.getByTestId('no-results')).toContainText('No results for "flying-car"');
});

test('unknown product shows a not-found page', async ({ page }) => {
  await page.goto('/product/does-not-exist');
  await expect(page.getByTestId('error-message')).toContainText('does-not-exist does not exist');
});

test('out-of-stock product cannot be added to the cart', async ({ page }) => {
  await page.goto('/product/dyson-v12');
  await expect(page.getByTestId('stock-status')).toHaveText('Out of stock');
  await expect(page.getByTestId('add-to-cart')).toBeDisabled();
});

test('invalid coupon is rejected with the reason', async ({ page, request }) => {
  await loginAs(page, 'bob@qamart.test');
  const token = await page.evaluate(() => localStorage.getItem('qamart.token'));
  await request.delete('/api/cart', { headers: { authorization: `Bearer ${token}` } });
  await request.post('/api/cart/items', { headers: { authorization: `Bearer ${token}` }, data: { productId: 'jbl-flip-6' } });
  await page.goto('/cart');
  await page.getByTestId('coupon-input').fill('EXPIRED20');
  await page.getByTestId('apply-coupon').click();
  await expect(page.getByTestId('error-message')).toContainText('EXPIRED20 expired');
});

test('server-side validation errors are shown next to the checkout fields', async ({ page, request }) => {
  await loginAs(page, 'bob@qamart.test');
  const token = await page.evaluate(() => localStorage.getItem('qamart.token'));
  await request.delete('/api/cart', { headers: { authorization: `Bearer ${token}` } });
  await request.post('/api/cart/items', { headers: { authorization: `Bearer ${token}` }, data: { productId: 'jbl-flip-6' } });
  await page.goto('/checkout');
  await page.getByTestId('address-pincode').fill('012345');
  await page.getByTestId('address-phone').fill('12345');
  await page.getByTestId('place-order').click();
  await expect(page.getByTestId('error-pincode')).toHaveText('must be a valid 6-digit PIN code');
  await expect(page.getByTestId('error-phone')).toHaveText('must be a valid 10-digit mobile number');
});

test('declined payment keeps the customer on checkout with a clear message', async ({ page, request }) => {
  await loginAs(page, 'bob@qamart.test');
  const token = await page.evaluate(() => localStorage.getItem('qamart.token'));
  await request.delete('/api/cart', { headers: { authorization: `Bearer ${token}` } });
  await request.post('/api/cart/items', { headers: { authorization: `Bearer ${token}` }, data: { productId: 'jbl-flip-6' } });
  await page.goto('/checkout');
  await page.getByTestId('pay-demo_decline').check();
  await page.getByTestId('place-order').click();
  await expect(page.getByTestId('error-message')).toContainText('Insufficient funds');
  await expect(page).toHaveURL(/\/checkout$/);
});
