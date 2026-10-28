/** Cart service: state changes, validation and business limits. */
import { expect, test } from '@playwright/test';
import { addToCart, expectError, freshShopper } from '../support/api';
import { expectSchema } from '../support/contract';

test.describe('Cart API', () => {
  test('add, update quantity, remove', async ({ request }) => {
    const s = await freshShopper(request, 42);
    let cart = await addToCart(request, s.token, 'airpods-pro-2', 2);
    expectSchema(cart, 'Cart');
    expect(cart).toMatchObject({ itemCount: 2, subtotal: 2 * 20900 });

    cart = await addToCart(request, s.token, 'airpods-pro-2', 1); // adds to existing line
    expect(cart.items[0].quantity).toBe(3);

    cart = await (await request.patch('/api/cart/items/airpods-pro-2', { headers: s.headers, data: { quantity: 1 } })).json();
    expect(cart.subtotal).toBe(20900);

    cart = await (await request.delete('/api/cart/items/airpods-pro-2', { headers: s.headers })).json();
    expect(cart).toMatchObject({ items: [], itemCount: 0, subtotal: 0 });
  });

  test('quantity boundaries: 0 and 11 are rejected, 10 is allowed', async ({ request }) => {
    const s = await freshShopper(request, 42);
    await expectError(await request.post('/api/cart/items', { headers: s.headers, data: { productId: 'jbl-flip-6', quantity: 0 } }), 400, 'VALIDATION_ERROR');
    await expectError(await request.post('/api/cart/items', { headers: s.headers, data: { productId: 'jbl-flip-6', quantity: 11 } }), 400, 'VALIDATION_ERROR');
    await expectError(await request.post('/api/cart/items', { headers: s.headers, data: { productId: 'jbl-flip-6', quantity: 1.5 } }), 400, 'VALIDATION_ERROR');
    await addToCart(request, s.token, 'jbl-flip-6', 10);
  });

  test('the per-product limit also applies across several adds (422)', async ({ request }) => {
    const s = await freshShopper(request, 42);
    await addToCart(request, s.token, 'jbl-flip-6', 8);
    await expectError(await request.post('/api/cart/items', { headers: s.headers, data: { productId: 'jbl-flip-6', quantity: 3 } }), 422, 'CART_LIMIT_EXCEEDED');
  });

  test('unknown product and unknown cart line return 404', async ({ request }) => {
    const s = await freshShopper(request, 42);
    await expectError(await request.post('/api/cart/items', { headers: s.headers, data: { productId: 'unicorn-phone' } }), 404, 'PRODUCT_NOT_FOUND');
    await expectError(await request.patch('/api/cart/items/unicorn-phone', { headers: s.headers, data: { quantity: 2 } }), 404, 'ITEM_NOT_IN_CART');
  });

  test('carts are isolated per user', async ({ request }) => {
    const a = await freshShopper(request, 43);
    const b = await freshShopper(request, 44);
    await addToCart(request, a.token, 'mi-tv-43');
    const bCart = await (await request.get('/api/cart', { headers: b.headers })).json();
    expect(bCart.items).toHaveLength(0);
  });
});
