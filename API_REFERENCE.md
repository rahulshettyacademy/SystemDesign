# QAMart API Reference

* **Base URL:** `http://localhost:8080` (Nginx gateway). Interactive docs: http://localhost:8080/api-docs/
* **Format:** JSON in, JSON out. Amounts are whole **INR** integers.
* **Auth:** `POST /api/auth/login` → `token`. Send `Authorization: Bearer <token>`. Tokens last 8 h.
* **Correlation:** every response has `X-Request-ID`. You may send your own (`[A-Za-z0-9-]{8,64}`) and it is propagated to every service, log line and message.
* **Lab diagnostics** (only when `LAB_MODE=true`): `X-Served-By` (instance), `X-Cache` (`HIT` / `MISS` / `BYPASS`), `X-Cache-TTL`.

## Error format

Every error, from any service or from the gateway itself:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "limit", "message": "must be <= 50" }],
    "requestId": "8e06d753b159aa8f66161c64d6cf66e9"
  }
}
```

| Status | Codes |
|---|---|
| 400 | `VALIDATION_ERROR` (with `details[]`), `INVALID_JSON`, `CART_EMPTY`, `IDEMPOTENCY_KEY_REQUIRED`, `IDEMPOTENCY_KEY_INVALID` |
| 401 | `AUTH_REQUIRED`, `TOKEN_INVALID`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS` |
| 402 | `PAYMENT_DECLINED` |
| 403 | `FORBIDDEN` (role), `INTERNAL_ONLY`, `LAB_TOKEN_REQUIRED` |
| 404 | `NOT_FOUND`, `PRODUCT_NOT_FOUND`, `ORDER_NOT_FOUND`, `ITEM_NOT_IN_CART` |
| 409 | `OUT_OF_STOCK`, `REQUEST_IN_PROGRESS`, `PRODUCT_UNAVAILABLE` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `CART_LIMIT_EXCEEDED`, `COUPON_INVALID`, `COUPON_INACTIVE`, `COUPON_EXPIRED`, `COUPON_MIN_SUBTOTAL`, `COUPON_EXHAUSTED`, `COUPON_ALREADY_USED` |
| 500 | `INTERNAL_ERROR`, `INJECTED_FAULT` (lab) |
| 502/503/504 | `SERVICE_UNAVAILABLE` (gateway: no instance reachable), `UPSTREAM_*`, `PAYMENT_UNAVAILABLE`, `INVENTORY_UNAVAILABLE`, `CART_UNAVAILABLE`, `CATALOG_UNAVAILABLE`, `PRODUCT_SERVICE_UNAVAILABLE` |

## Endpoints

| Method & path | Auth | Service | Purpose |
|---|---|---|---|
| `POST /api/auth/login` | – | auth | Log in |
| `GET /api/auth/me` | ✔ | auth | Current user |
| `GET /api/products` | – | product (×3) | Search / browse |
| `GET /api/products/categories` | – | product | Categories + counts |
| `GET /api/products/sale` | – | product | Sale status |
| `GET /api/products/{id}` | – | product | Details (cached) |
| `PATCH /api/products/{id}` | admin | product | Update price/MRP/name, invalidate cache |
| `GET /api/inventory?productIds=a,b` | – | inventory | Stock for several products |
| `GET /api/inventory/{productId}` | – | inventory | Stock for one product |
| `GET /api/cart` | ✔ | cart | Get cart |
| `DELETE /api/cart` | ✔ | cart | Empty cart |
| `POST /api/cart/items` | ✔ | cart | Add product |
| `PATCH /api/cart/items/{productId}` | ✔ | cart | Change quantity |
| `DELETE /api/cart/items/{productId}` | ✔ | cart | Remove product |
| `GET /api/coupons` | – | order | Usable coupons |
| `POST /api/coupons/validate` | ✔ | order | Check a coupon (no redemption) |
| `POST /api/orders` | ✔ + `Idempotency-Key` | order | **Checkout** |
| `GET /api/orders` | ✔ | order | Order history |
| `GET /api/orders/{id}` | ✔ owner/admin | order | Order details + status timeline |
| `GET /api/payments?orderId=` | ✔ owner/admin | payment | Charges for an order |
| `GET /api/notifications[?orderId=]` | ✔ | notification | Your notifications |

---

## Auth

```bash
curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"alice@qamart.test","password":"Password@123"}'
```
```json
{ "token": "eyJhbGciOi…", "user": { "id": "00000000-0000-4000-8000-000000000001", "email": "alice@qamart.test", "name": "Alice Sharma", "role": "customer" } }
```
Wrong email **or** password: `401 INVALID_CREDENTIALS` (same message, so it doesn't reveal which accounts exist).

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@qamart.test","password":"Password@123"}' | sed -E 's/.*"token":"([^"]+)".*/\1/')
```

## Products

`GET /api/products` query parameters: `q` (≤100 chars), `category` (`mobiles|laptops|audio|wearables|tv|home|fashion|appliances`), `deals=true`, `sort` (`relevance|price_asc|price_desc|rating`), `page` (≥1), `limit` (1-50). **Unknown parameters are rejected (400).**

```bash
curl -s "http://localhost:8080/api/products?q=iphone&sort=price_asc&limit=2"
```
```json
{
  "items": [
    { "id": "iphone-15-128", "sku": "MOB-APL-IP15-128", "name": "Apple iPhone 15 (128 GB) - Black", "brand": "Apple",
      "category": "mobiles", "price": 69900, "mrp": 79900, "rating": 4.6, "reviews": 12873,
      "image": { "icon": "phone", "color": "#1f2937" }, "sale": null }
  ],
  "page": 1, "limit": 2, "total": 2, "totalPages": 1
}
```

`GET /api/products/{id}` adds `description`, `specs` (or `null`), `variants` (or `null`), `tags`, `updatedAt`. The shape of `specs`/`variants` depends on the category (flexible MongoDB documents).

```bash
curl -si http://localhost:8080/api/products/iphone-15-128 | grep -iE 'x-cache|x-served-by'
# X-Served-By: product-3
# X-Cache: MISS        (then HIT on the next call, until the TTL expires)
```

Admin update (cache invalidation):
```bash
curl -s -X PATCH http://localhost:8080/api/products/iphone-15-128 -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"price":74900}'
# { "product": { …, "price": 74900 }, "cacheInvalidated": true }
```
As a customer: `403 FORBIDDEN`.

## Inventory

```bash
curl -s "http://localhost:8080/api/inventory?productIds=iphone-15-128,dyson-v12"
# { "items": [ { "productId": "dyson-v12", "available": 0, "status": "OUT_OF_STOCK" },
#              { "productId": "iphone-15-128", "available": 25, "status": "IN_STOCK" } ] }
```
`status` is `LOW_STOCK` when `available <= 5`.

## Cart

```bash
curl -s -X POST http://localhost:8080/api/cart/items -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"productId":"iphone-15-128","quantity":1}'
```
```json
{ "userId": "00000000-0000-4000-8000-000000000001",
  "items": [ { "productId": "iphone-15-128", "name": "Apple iPhone 15 (128 GB) - Black", "unitPrice": 69900,
               "image": { "icon": "phone", "color": "#1f2937" }, "quantity": 1, "lineTotal": 69900 } ],
  "itemCount": 1, "subtotal": 69900 }
```
Rules: quantity 1-10 per request (400 otherwise); at most 10 of one product in the cart (`422 CART_LIMIT_EXCEEDED`); unknown product `404`; product service down `503 PRODUCT_SERVICE_UNAVAILABLE`. `unitPrice` is a **snapshot** taken when the item was added.

## Coupons

```bash
curl -s http://localhost:8080/api/coupons
curl -s -X POST http://localhost:8080/api/coupons/validate -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"code":"welcome10","subtotal":69900}'
# { "valid": true, "code": "WELCOME10", "description": "10% off your order (max ₹1,000)", "discount": 1000, "totalAfterDiscount": 68900 }
```

| Code | Rule |
|---|---|
| `WELCOME10` | 10%, max ₹1,000 |
| `FLAT500` | ₹500 off, minimum ₹5,000 |
| `LIMITED1` | ₹1,000 off, minimum ₹2,000, **one redemption in total** |
| `EXPIRED20` | expired on 2025-01-01 |
| `DIWALI50` | 50%, max ₹2,000, minimum ₹999, **sale only**, once per customer, 100 uses |

Codes are case-insensitive. A coupon is **redeemed** only by a successful `POST /api/orders` and **given back** if payment fails.

## Orders (checkout)

```bash
curl -s -i -X POST http://localhost:8080/api/orders \
  -H "authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H 'content-type: application/json' \
  -d '{
        "paymentMethod": "demo_success",
        "couponCode": "WELCOME10",
        "shippingAddress": { "name": "Alice Sharma", "line1": "12 MG Road, Indiranagar",
                             "city": "Bengaluru", "pincode": "560038", "phone": "9876543210" }
      }'
```
```json
HTTP/1.1 201 Created
{
  "id": "5ba69310-2811-473b-80be-79af4a2d5db4", "orderNumber": "QM-100001", "status": "CONFIRMED",
  "items": [ { "productId": "iphone-15-128", "name": "Apple iPhone 15 (128 GB) - Black", "unitPrice": 69900, "quantity": 1, "lineTotal": 69900 } ],
  "subtotal": 69900, "discount": 1000, "total": 68900, "couponCode": "WELCOME10",
  "paymentMethod": "demo_success", "paymentId": "31871c35-8e4a-472b-a998-e1ef8956d814", "failure": null,
  "shippingAddress": { … }, "createdAt": "…", "updatedAt": "…",
  "events": [
    { "status": "PENDING", "note": "Order created with coupon WELCOME10 (-₹1000)", "at": "…" },
    { "status": "PAYMENT_PENDING", "note": "Stock reserved; requesting payment", "at": "…" },
    { "status": "CONFIRMED", "note": "Payment 31871c35 succeeded", "at": "…" }
  ],
  "priceChanges": []
}
```

**Payment methods (simulated):** `demo_success` (~0.3 s), `demo_slow` (~2 s), `demo_decline` (always declined).

**Validation:** `pincode` `^[1-9][0-9]{5}$`, `phone` `^[6-9][0-9]{9}$`, `line1` ≥ 5 chars, `name` and `city` ≥ 2 chars. No extra fields allowed.

### Outcomes

| HTTP | Meaning | Body |
|---|---|---|
| **201** | `CONFIRMED`: paid, stock reserved, `OrderCreated` event queued | Order |
| **200** + `Idempotent-Replay: true` | same `Idempotency-Key` seen before: the **original** order, nothing new created or charged | Order |
| **202** | `PAYMENT_PENDING`: payment outcome unknown (timeout). Stock stays reserved; a reconciler resolves it in ~15-30 s | `{ error, order }` |
| **402** | `PAYMENT_DECLINED`: order `PAYMENT_FAILED`, stock and coupon released, cart kept | `{ error, order }` |
| **409** | `OUT_OF_STOCK` (order `REJECTED`, `details: {productId, requested, available}`) · `REQUEST_IN_PROGRESS` (an identical request is running) | `{ error, order? }` |
| **422** | `COUPON_*`: nothing created | `{ error }` |
| **503** | `PAYMENT_UNAVAILABLE` / `INVENTORY_UNAVAILABLE` / `CART_UNAVAILABLE` / `CATALOG_UNAVAILABLE`: **customer not charged** | `{ error, order? }` |

### Idempotency rules
* `Idempotency-Key` is **required**: 8-100 chars of `[A-Za-z0-9_-]` (a UUID is ideal).
* The key is scoped to the user: `UNIQUE (user_id, idempotency_key)` in `order_db`.
* Generate **one key per checkout attempt**. Reuse it for retries and double clicks. Generate a new one after a definite failure (402/409/422/503) if the customer tries again.
* Internally the order service charges with key `pay_<orderId>`, which is UNIQUE in `payment_db`, so its own retries can't double-charge.

### Order history and details
```bash
curl -s http://localhost:8080/api/orders -H "authorization: Bearer $TOKEN"
curl -s http://localhost:8080/api/orders/<id> -H "authorization: Bearer $TOKEN"
```
Another customer's order returns **404** (not 403), so the API doesn't confirm that an ID exists.

## Payments

```bash
curl -s "http://localhost:8080/api/payments?orderId=<id>" -H "authorization: Bearer $TOKEN"
```
```json
{ "items": [ { "paymentId": "…", "idempotencyKey": "pay_<orderId>", "orderId": "…", "amount": 68900, "currency": "INR",
               "method": "demo_success", "status": "SUCCEEDED", "declineReason": null, "requestCount": 1, "replayed": false, "createdAt": "…" } ] }
```
`requestCount > 1` means retries happened, yet only one charge exists.

## Notifications

```bash
curl -s "http://localhost:8080/api/notifications?orderId=<id>" -H "authorization: Bearer $TOKEN"
```
```json
{ "items": [ { "id": "…", "orderId": "…", "orderNumber": "QM-100001", "type": "ORDER_CONFIRMATION", "channel": "email (simulated)",
               "subject": "Your QAMart order QM-100001 is confirmed", "body": "Hi Alice Sharma, …", "status": "SENT", "attempts": 1, "createdAt": "…" } ] }
```
Created **asynchronously**: it may be empty for a moment right after checkout. Poll instead of asserting immediately.

---

## Non-public APIs (for reference)

These are **not** routed by the gateway. You can only call them inside the Docker network.

| Area | Path | Guard |
|---|---|---|
| Service-to-service | `/internal/*` (e.g. `GET /internal/carts/{userId}`, `POST /internal/reservations`, `POST /internal/payments`) | `X-Internal-Token` |
| Health | `/health` (liveness), `/ready` (dependencies) on every service | – |
| Teaching | `/__lab/*` on every service (faults, reset, actions) | `LAB_MODE=true` + `X-Lab-Token` |
| Teaching dashboard API | `http://localhost:8081/lab/api/*` (scenarios, demos, traces, data, reset) | local only, lab mode only |

Useful lab API calls for test automation (see `tests/support/lab.ts`):

```bash
curl -s -X POST localhost:8081/lab/api/reset
curl -s localhost:8081/lab/api/scenarios
curl -s -X POST localhost:8081/lab/api/scenarios/payment-timeout/activate
curl -s -X POST localhost:8081/lab/api/scenarios/payment-timeout/deactivate
curl -s -X POST localhost:8081/lab/api/inventory/stock -H 'content-type: application/json' -d '{"items":[{"productId":"iphone-15-pro-256","available":1}]}'
curl -s -X PUT  localhost:8081/lab/api/faults/product-2 -H 'content-type: application/json' -d '{"http.latencyMs":1500}'
curl -s localhost:8081/lab/api/data/payments           # read-only datasets: orders, payments, stock, reservations, outbox, notifications, cache …
curl -s localhost:8081/lab/api/traces/<request-id>     # spans + logs of one request
curl -s -X POST localhost:8081/lab/api/sale -H 'content-type: application/json' -d '{"active":true}'
```
