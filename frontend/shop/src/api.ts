/**
 * Every HTTP call the shop makes goes through here, so students can see exactly
 * what the browser sends and receives (and the API Inspector can list it).
 */
export interface ApiCall {
  id: number;
  method: string;
  path: string;
  status: number;
  ms: number;
  requestId: string | null;
  servedBy: string | null;
  cache: string | null;
  errorCode?: string;
  at: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
    public requestId?: string | null,
    public body?: any,
  ) {
    super(message);
  }
}

const TOKEN_KEY = 'qamart.token';
let token: string | null = (() => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
})();

export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

let seq = 0;
const listeners = new Set<(c: ApiCall) => void>();
export const onApiCall = (fn: (c: ApiCall) => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
let unauthorizedHandler: (() => void) | null = null;
export const onUnauthorized = (fn: () => void) => (unauthorizedHandler = fn);

export async function api<T = any>(
  method: string,
  path: string,
  body?: unknown,
  opts: { headers?: Record<string, string>; okStatuses?: number[] } = {},
): Promise<T> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    emit({ method, path, status: 0, ms: performance.now() - started, requestId: null, servedBy: null, cache: null, errorCode: 'NETWORK_ERROR' });
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach QAMart. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  const call = {
    method,
    path,
    status: res.status,
    ms: performance.now() - started,
    requestId: res.headers.get('x-request-id'),
    servedBy: res.headers.get('x-served-by'),
    cache: res.headers.get('x-cache'),
    errorCode: data?.error?.code,
  };
  emit(call);
  if (res.status === 401 && token && !path.endsWith('/login')) unauthorizedHandler?.();
  if (!res.ok && !(opts.okStatuses ?? []).includes(res.status)) {
    throw new ApiError(res.status, data?.error?.code ?? 'HTTP_ERROR', data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details, call.requestId, data);
  }
  return data as T;
}

function emit(c: Omit<ApiCall, 'id' | 'at'>) {
  const call: ApiCall = { ...c, ms: Math.round(c.ms), id: ++seq, at: Date.now() };
  listeners.forEach((l) => l(call));
}

export const formatINR = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'key-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

/** Link from the shop's API inspector to the same request in the Teaching Dashboard. */
export const dashboardTraceUrl = (requestId: string) => `${location.protocol}//${location.hostname}:8081/traces/${requestId}`;

// ---------------------------------------------------------------- shared types
export interface ProductSummary {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  mrp: number;
  rating: number;
  reviews: number;
  image: { icon: string; color: string };
  sale: { label: string; regularPrice: number } | null;
}
export interface ProductDetail extends ProductSummary {
  description: string;
  specs: Record<string, string> | null;
  variants: Record<string, string[]> | null;
  tags: string[];
}
export interface StockInfo {
  productId: string;
  available: number;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
}
export interface CartItem {
  productId: string;
  name: string;
  unitPrice: number;
  image: { icon: string; color: string };
  quantity: number;
  lineTotal: number;
}
export interface Cart {
  items: CartItem[];
  itemCount: number;
  subtotal: number;
}
export interface Order {
  id: string;
  orderNumber: string;
  status: 'PENDING' | 'PAYMENT_PENDING' | 'CONFIRMED' | 'PAYMENT_FAILED' | 'REJECTED';
  items: Array<{ productId: string; name: string; unitPrice: number; quantity: number; lineTotal: number }>;
  subtotal: number;
  discount: number;
  total: number;
  couponCode: string | null;
  paymentMethod: string;
  paymentId: string | null;
  failure: { code: string; reason: string } | null;
  shippingAddress: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  events: Array<{ status: string; note: string; at: string }>;
  priceChanges?: Array<{ productId: string; cartPrice: number; currentPrice: number }>;
}
export interface Notification {
  id: string;
  orderId: string;
  orderNumber: string;
  subject: string;
  body: string;
  channel: string;
  status: string;
  attempts: number;
  createdAt: string;
}
export interface User {
  id: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
}
