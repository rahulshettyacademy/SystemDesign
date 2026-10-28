import { APIRequestContext, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const SHOP_URL = process.env.SHOP_URL ?? 'http://localhost:8080';
export const LAB_URL = process.env.LAB_URL ?? 'http://localhost:8081';
export const PASSWORD = 'Password@123';

export const ADDRESS = { name: 'Test Shopper', line1: '42 Residency Road', city: 'Bengaluru', pincode: '560025', phone: '9123456780' };

/** Teaching-dashboard API (local lab only): faults, scenarios, demos, data. */
export async function lab<T = any>(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown): Promise<T> {
  const res = await request.fetch(`${LAB_URL}/lab/api${path}`, { method, data, timeout: 90_000 });
  expect(res.status(), `lab ${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return res.json();
}

export const activate = (request: APIRequestContext, scenario: string) => lab(request, 'POST', `/scenarios/${scenario}/activate`);
export const deactivate = (request: APIRequestContext, scenario: string) => lab(request, 'POST', `/scenarios/${scenario}/deactivate`);

/** Instructor override of stock levels (inventory service lab action). */
export async function setStock(request: APIRequestContext, productId: string, available: number) {
  return lab(request, 'POST', '/inventory/stock', { items: [{ productId, available }] });
}

export async function dataset(request: APIRequestContext, id: string) {
  return (await lab<{ rows: any[] }>(request, 'GET', `/data/${id}`)).rows;
}

/** Poll until fn returns a truthy value (eventual consistency!). */
export async function eventually<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 15_000, intervalMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    if (Date.now() > deadline) throw new Error(`Condition not met within ${timeoutMs}ms${last ? `: ${last}` : ''}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export const newKey = () => randomUUID();
