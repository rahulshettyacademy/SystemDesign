---
name: qamart-requirements
description: The QAMart e-commerce requirement document (auth, catalog, inventory, cart, coupons, checkout, payments, notifications, non-functional rules) with numbered requirements and acceptance criteria. Use when writing, reviewing or tracing test scenarios or test cases for QAMart, or when asked what QAMart is supposed to do.
---

# QAMart Requirement Document (v1.0)

QAMart is an Amazon-style online shop. A customer searches for products, checks stock, adds items to a
cart, applies a coupon, pays, and receives an order confirmation and an email notification.

Use this document as the **source of truth** for expected behaviour. Every test scenario you write must
trace to one or more requirement IDs below (for example `REQ-CPN-04`).

## How to write test scenarios from this document

When asked to generate scenarios:

1. Work section by section. For each requirement, cover:
   * the **positive** path,
   * every listed **rejection / error code**,
   * **boundary values** for every number or length limit (min − 1, min, max, max + 1),
   * **state** rules (things that depend on earlier actions, such as "already used"),
   * **concurrency** rules where the requirement says "at the same time", "exactly one", or "never twice",
   * **failure / degradation** rules where a dependency is down or slow.
2. Output a table: `ID | Scenario | Requirement(s) | Type (positive / negative / boundary / state / concurrency / failure) | Expected result`.
   Use IDs like `TS-CPN-001`.
3. Write the scenario as **behaviour**, not as steps through a particular UI or tool. Don't assign test
   layers at this stage. Layer assignment is a separate step (see the `shift-left-testing` skill).
4. Don't invent behaviour that isn't in this document. If something is ambiguous, list it under
   **Open questions** at the end instead of guessing.

## System context

The layer-assignment step needs to know which component owns each rule.

| Component | Owns | Datastore |
|---|---|---|
| Web shop (UI) | Pages, forms, messages shown to the customer | – |
| API gateway / load balancer | Routing `/api/*`, spreading load over product instances, JSON 404 for unknown routes | – |
| Auth service | Login, tokens, roles | PostgreSQL `auth_db` |
| Product service (×3 instances) | Catalog search, product details, admin price updates, sale prices | MongoDB `catalog_db` + Redis cache |
| Inventory service | Stock levels, reservations, releases | PostgreSQL `inventory_db` |
| Cart service | Cart lines per customer | PostgreSQL `cart_db` |
| Order service | Coupons, checkout orchestration, orders, idempotency, outbox | PostgreSQL `order_db` → RabbitMQ |
| Payment service | Simulated charges | PostgreSQL `payment_db` |
| Notification service | Order confirmation emails (simulated) | consumes RabbitMQ → MongoDB `notification_db` |

All money values are whole Indian rupees (₹), stored as integers.

---

## 1. Authentication & authorisation (`REQ-AUTH`)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| REQ-AUTH-01 | A registered user logs in with email + password. | Valid credentials → 200 with a token and the user's id, email, name and role. |
| REQ-AUTH-02 | Login must not reveal which accounts exist. | Wrong password **and** unknown email both → `401 INVALID_CREDENTIALS` with the **same** message. |
| REQ-AUTH-03 | Login input is validated. | Missing/malformed email or password → `400 VALIDATION_ERROR` with field details. Body that isn't JSON → `400 INVALID_JSON`. |
| REQ-AUTH-04 | Cart, checkout, orders, payments and notifications require a logged-in user. | No token → `401 AUTH_REQUIRED`; bad token → `401 TOKEN_INVALID`; expired → `401 TOKEN_EXPIRED`. |
| REQ-AUTH-05 | Roles: `customer` and `admin`. Only admins may change product price/MRP/name. | Customer attempting it → `403 FORBIDDEN`. |
| REQ-AUTH-06 | A customer can only see their own orders, payments and notifications. | Another customer's order id → `404 ORDER_NOT_FOUND` (not 403), so ids can't be probed. |
| REQ-AUTH-07 | The UI shows a generic error on failed login. | Login page shows one message that doesn't say whether the email or the password was wrong. |

## 2. Product catalog & search (`REQ-CAT`)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| REQ-CAT-01 | Customers can search and browse without logging in. | `q` matches product name and brand, case-insensitive. |
| REQ-CAT-02 | Filters: `category` ∈ {mobiles, laptops, audio, wearables, tv, home, fashion, appliances}; `deals=true`. | Unknown category → `400 VALIDATION_ERROR`. |
| REQ-CAT-03 | Sorting: `relevance` (default), `price_asc`, `price_desc`, `rating`. | `price_asc` results are in non-decreasing price order, etc. |
| REQ-CAT-04 | Pagination: `page` ≥ 1, `limit` 1-50. | Response includes `page`, `limit`, `total`, `totalPages`; page 2 never repeats page 1 items. Out-of-range values → 400. |
| REQ-CAT-05 | `q` is at most 100 characters. | 101 characters → 400. |
| REQ-CAT-06 | Unknown query parameters are rejected. | `?foo=bar` → 400. |
| REQ-CAT-07 | A search with no matches is not an error. | 200 with an empty `items` list. UI shows an empty-state message. |
| REQ-CAT-08 | Product details include description, specs, variants and tags; specs/variants differ by category. | Unknown id → `404 PRODUCT_NOT_FOUND`; malformed id → 400. UI shows a not-found page. |
| REQ-CAT-09 | Each product shows price and MRP; discount % shown when price < MRP. | Discount % = round((MRP − price) / MRP × 100) is shown on listing and details. |
| REQ-CAT-10 | Admin can update price, MRP or name. | Response confirms the change; the **next** read by any customer returns the new price (no stale cache). |
| REQ-CAT-11 | Product details are cached for speed. | A repeat read is served from cache until the entry expires or the product is updated. |
| REQ-CAT-12 | If the cache is unavailable, product pages still work. | Reads fall back to the database; no customer-facing error. |
| REQ-CAT-13 | Search traffic is spread over all healthy product instances. | Even distribution with all instances up; if one instance is down, no customer requests fail. |

## 3. Diwali sale (`REQ-SALE`)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| REQ-SALE-01 | During the sale, selected products show a sale price and label (e.g. "Diwali Lightning Deal"). | Outside the sale, the normal price is shown and no label. |
| REQ-SALE-02 | Some deals have limited stock (e.g. 5 units). | When the deal stock is gone, the product shows out of stock. |
| REQ-SALE-03 | Sale-only coupons (`DIWALI50`) are usable only while the sale is active. | Outside the sale → `422 COUPON_INACTIVE` with a message saying it's sale-only. |

## 4. Inventory (`REQ-INV`)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| REQ-INV-01 | Stock can be queried for one or several products. | Each item returns `available` and `status`. |
| REQ-INV-02 | Stock status: `OUT_OF_STOCK` when available = 0, `LOW_STOCK` when 1-5, `IN_STOCK` when > 5. | Boundaries 0, 1, 5, 6 map exactly as stated. |
| REQ-INV-03 | Stock must never go negative or be oversold. | When N customers buy the last M units at the same time, exactly M orders succeed; the rest get `409 OUT_OF_STOCK`. |
| REQ-INV-04 | Multi-item orders reserve all items or none. | If any item is short, nothing is reserved; error details include `productId`, `requested`, `available`. |
| REQ-INV-05 | Reserved stock is returned if the order fails (payment declined). | Available count goes back to its value before the checkout. |
| REQ-INV-06 | If inventory is unavailable, the product page still renders. | Stock is shown as "unknown"; checkout fails with `503 INVENTORY_UNAVAILABLE` and the customer is not charged. |
| REQ-INV-07 | The UI prevents adding an out-of-stock product to the cart. | Add-to-cart is disabled / shows out of stock. |

## 5. Cart (`REQ-CART`)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| REQ-CART-01 | A logged-in customer can add, change quantity of, and remove products, and empty the cart. | Cart returns items, `itemCount`, `subtotal`. |
| REQ-CART-02 | Quantity per request is a whole number 1-10. | 0, 11, decimals, non-numbers → `400 VALIDATION_ERROR`. |
| REQ-CART-03 | At most 10 units of one product in the cart, across all adds. | e.g. 6 then 5 → `422 CART_LIMIT_EXCEEDED`; the cart keeps 6. |
| REQ-CART-04 | `lineTotal = unitPrice × quantity`; `subtotal` = sum of line totals. | Holds after every add/update/remove. |
| REQ-CART-05 | `unitPrice` is a snapshot of the price when the item was added. | Later catalog price changes don't change the cart line (see REQ-ORD-07 for checkout). |
| REQ-CART-06 | Unknown product → `404 PRODUCT_NOT_FOUND`; updating/removing a product not in the cart → `404 ITEM_NOT_IN_CART`. | |
| REQ-CART-07 | Each customer has their own cart. | Customer B never sees customer A's items. |
| REQ-CART-08 | If the product service is down, adding to cart fails cleanly. | `503 PRODUCT_SERVICE_UNAVAILABLE`; existing cart unchanged. |

## 6. Coupons (`REQ-CPN`)

| Code | Rule |
|---|---|
| `WELCOME10` | 10 % off, max discount ₹1,000, no minimum |
| `FLAT500` | ₹500 off, minimum subtotal ₹5,000 |
| `LIMITED1` | ₹1,000 off, minimum ₹2,000, **one redemption in total across all customers** |
| `EXPIRED20` | 20 % off, expired on 2025-01-01 |
| `DIWALI50` | 50 % off, max ₹2,000, minimum ₹999, **sale only**, once per customer, 100 uses in total |

| ID | Requirement | Acceptance criteria |
|---|---|---|
| REQ-CPN-01 | Customers can list currently usable coupons. | Inactive, expired and fully-redeemed coupons are not listed. |
| REQ-CPN-02 | Codes are case-insensitive and surrounding spaces are ignored. | `" welcome10 "` = `WELCOME10`. |
| REQ-CPN-03 | Percentage discount = floor(subtotal × % / 100), capped at the coupon's max discount. | `WELCOME10` on ₹69,900 → ₹1,000; on ₹5,000 → ₹500. `DIWALI50` on ₹999 → ₹499; on ₹10,000 → ₹2,000. |
| REQ-CPN-04 | Flat discount never exceeds the subtotal. | Total after discount is never negative. |
| REQ-CPN-05 | Rejection reasons, checked **in this order**: unknown → `COUPON_INVALID`; inactive → `COUPON_INACTIVE`; expired → `COUPON_EXPIRED`; below minimum → `COUPON_MIN_SUBTOTAL`; total uses reached → `COUPON_EXHAUSTED`; customer's uses reached → `COUPON_ALREADY_USED`. All are HTTP 422. | Only the **first** failing rule is reported. |
| REQ-CPN-06 | Validating a coupon shows the discount and total but does **not** use it up. | Validating `LIMITED1` 10 times leaves it redeemable. |
| REQ-CPN-07 | A coupon is redeemed only by a successful checkout. | Usage count increases by 1 per confirmed order. |
| REQ-CPN-08 | Usage limits hold under concurrency. | Two customers checking out with `LIMITED1` at the same moment → exactly one succeeds, the other gets `COUPON_EXHAUSTED`. |
| REQ-CPN-09 | A coupon is given back if payment is declined. | Usage count and the customer's redemption are restored. |
| REQ-CPN-10 | The UI shows the rejection reason next to the coupon field. | Message matches the error code's meaning. |

## 7. Checkout & orders (`REQ-ORD`)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| REQ-ORD-01 | Checkout needs a non-empty cart, a payment method and a shipping address; coupon optional. | Empty cart → `400 CART_EMPTY`. Extra/unknown fields → 400. |
| REQ-ORD-02 | Address validation: `name` ≥ 2 chars, `line1` ≥ 5 chars, `city` ≥ 2 chars, `pincode` 6 digits not starting with 0, `phone` 10 digits starting with 6-9. | Each failure → `400 VALIDATION_ERROR` naming the field. UI shows the error next to that field. |
| REQ-ORD-03 | Every checkout request carries an `Idempotency-Key` header: 8-100 chars of letters, digits, `-`, `_`. | Missing → `400 IDEMPOTENCY_KEY_REQUIRED`; bad format → `400 IDEMPOTENCY_KEY_INVALID`. |
| REQ-ORD-04 | The same key from the same customer never creates a second order or charge. | Repeat → `200` with header `Idempotent-Replay: true` and the **original** order. Two identical requests at the same moment → one order, one charge (the other may get `409 REQUEST_IN_PROGRESS`). |
| REQ-ORD-05 | Keys are scoped per customer. | Two different customers may use the same key value independently. |
| REQ-ORD-06 | Successful checkout → `201`, status `CONFIRMED`, with order number (`QM-…`), items, subtotal, discount, total, payment id and a status timeline (`PENDING` → `PAYMENT_PENDING` → `CONFIRMED`). Cart is emptied. | `total = subtotal − discount`. |
| REQ-ORD-07 | If a price changed since the item was added to the cart, the customer is charged the **current** price. | Order lists the change in `priceChanges` (`productId`, `cartPrice`, `currentPrice`). |
| REQ-ORD-08 | Invalid coupon at checkout → 422 and **no order is created**. | Order history unchanged; stock unchanged. |
| REQ-ORD-09 | Out of stock at checkout → `409 OUT_OF_STOCK`, order `REJECTED`, nothing charged. | |
| REQ-ORD-10 | Payment declined → `402 PAYMENT_DECLINED`, order `PAYMENT_FAILED`, stock and coupon released, **cart kept**. UI keeps the customer on checkout with a clear message. | |
| REQ-ORD-11 | Payment outcome unknown (timeout) → `202`, order `PAYMENT_PENDING`, stock stays reserved. A background reconciler resolves it to `CONFIRMED` or `PAYMENT_FAILED` within ~30 s. | Customer is never charged twice. |
| REQ-ORD-12 | Payment / inventory / cart / catalog service unavailable → `503` with the matching code; **customer not charged**. Browsing still works. | |
| REQ-ORD-13 | Order history lists the customer's orders newest first; order details show the status timeline. | Only own orders (REQ-AUTH-06). |

## 8. Payments (`REQ-PAY`)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| REQ-PAY-01 | Simulated methods: `demo_success` (~0.3 s), `demo_slow` (~2 s), `demo_decline` (always declined). | No real card data is ever collected. |
| REQ-PAY-02 | One order is charged at most once, even if the order service retries. | Payment record shows `requestCount` ≥ 1 but exactly one charge. |
| REQ-PAY-03 | Customers can view the charges for their own order. | Amount equals the order total, currency INR. |

## 9. Notifications (`REQ-NOT`)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| REQ-NOT-01 | Each confirmed order produces exactly one confirmation email (simulated) with the order number in the subject. | Delivered **asynchronously**; may appear a few seconds after checkout. |
| REQ-NOT-02 | Duplicate order events never produce duplicate emails. | Same event delivered twice → one notification. |
| REQ-NOT-03 | If the notification service is down, checkout still succeeds; the email is sent once it's back. | No lost confirmations. |
| REQ-NOT-04 | If the message broker is down, checkout still succeeds; events are delivered when it returns. | |
| REQ-NOT-05 | A message that keeps failing is retried 3 times, then moved to a dead-letter queue for manual re-drive. | |

## 10. Non-functional (`REQ-NFR`)

| ID | Requirement | Acceptance criteria |
|---|---|---|
| REQ-NFR-01 | All errors use one JSON format: `{ error: { code, message, details?, requestId } }`. | Every 4xx/5xx from every endpoint. |
| REQ-NFR-02 | Unknown API routes return a JSON 404 from the gateway. | |
| REQ-NFR-03 | A caller-supplied `X-Request-ID` is propagated through all services for tracing. | |
| REQ-NFR-04 | Request bodies over the size limit → `413 PAYLOAD_TOO_LARGE`. | |
| REQ-NFR-05 | Diwali sale load: the search → cart → checkout journey keeps p95 latency acceptable and error rate < 1 % at expected peak traffic. | No overselling under load (REQ-INV-03). |
| REQ-NFR-06 | Internal service-to-service endpoints are not reachable by customers. | Missing internal token → `403 INTERNAL_ONLY`. |
