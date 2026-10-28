import { request } from '@playwright/test';
import { LAB_URL, SHOP_URL } from './lab';

/** Reset the whole lab (data, faults, queues, cache) so every run starts from the same seeded state. */
export default async function globalSetup() {
  const ctx = await request.newContext();
  const health = await ctx.get(`${SHOP_URL}/nginx-health`).catch(() => null);
  if (!health?.ok()) throw new Error(`QAMart is not reachable at ${SHOP_URL}. Start it with: docker compose up --build -d`);
  const res = await ctx.post(`${LAB_URL}/lab/api/reset`, { timeout: 120_000 });
  if (res.status() >= 300) throw new Error(`Lab reset failed (${res.status()}): ${await res.text()}`);
  await ctx.dispose();
}
