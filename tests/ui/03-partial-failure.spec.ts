/** DEMO 2 - Microservices: one service down does not take the whole site down. */
import { expect, test } from '@playwright/test';
import { activate, deactivate, eventually } from '../support/lab';

test('inventory service down: product page still renders, stock shows "unknown" @slow', async ({ page, request }) => {
  test.setTimeout(90_000);
  await activate(request, 'inventory-down');
  try {
    await page.goto('/product/pixel-8-128');
    await expect(page.getByTestId('product-title')).toContainText('Pixel 8');
    await expect(page.getByTestId('stock-status')).toHaveText('Availability unknown');
  } finally {
    await deactivate(request, 'inventory-down');
  }
  // "Healthy" is not the same as "reachable": the gateway re-discovers the restarted
  // container through DNS (resolver valid=5s), so wait until the route works again.
  await eventually(async () => (await request.get('/api/inventory/pixel-8-128')).ok(), 15_000);
  await page.reload();
  await expect(page.getByTestId('stock-status')).toHaveText('In stock');
});
