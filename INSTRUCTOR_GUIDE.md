# Instructor Guide: System Design Fundamentals for Test Engineers

Every demo uses the **same customer journey** and the **real running system**. Keep two windows side by side while recording:

* **Left:** the shop, http://localhost:8080, with browser DevTools → Network open
* **Right:** the Teaching Dashboard, http://localhost:8081

> Shortcut: the shop has an **API Inspector** button (bottom-right, lab mode only). It lists every call with its status, timing, the instance that served it, the cache result and the request ID. Click a request ID to open its trace in the dashboard.

---

## 0. Before every lecture (2 minutes)

```bash
docker compose up -d          # if not running
docker compose ps             # everything "(healthy)" (adminer/nginx/redis have no healthcheck)
./scripts/reset.sh            # known state: faults off, data re-seeded, queues empty, cache empty
```

Dashboard → **Service health**: everything green. Dashboard → **Failure lab**: no switch active.

Demo accounts: `alice@qamart.test`, `bob@qamart.test`, `carol@qamart.test` / `Password@123`.

Seeded facts worth knowing in class:

| Fact | Value |
|---|---|
| iPhone 15 (`iphone-15-128`) | ₹69,900, stock 25 (5 during the sale) |
| iPhone 15 Pro (`iphone-15-pro-256`) | stock 12 (used by the "last unit" race demo) |
| Banarasi saree | stock 3 (shows "Only 3 left") |
| Dyson V12 | stock 0 (out of stock) |
| Coupons | `WELCOME10` 10% (max ₹1,000) · `FLAT500` ₹500 off ≥ ₹5,000 · `LIMITED1` one use only · `EXPIRED20` expired · `DIWALI50` sale only, once per customer |
| Cache TTL | 60 s |
| Payment timeout in the order service | 3 s, 3 attempts (backoff 300 ms, 900 ms) |
| Message retries | 3 attempts, 5 s apart, then DLQ |

---

## Demo 1: Frontend, backend and APIs (product search)

**Goal:** what really happens between a click and the results on screen.

1. Shop: type **iphone** in the search box and press Enter.
2. DevTools → Network → click `products?q=iphone`. Show:
   * **Request:** `GET /api/products?q=iphone`, no body, headers.
   * **Response:** `200`, JSON body (`items`, `total`, `page`…), headers `X-Request-ID`, `X-Served-By`.
3. Dashboard → **Request traces** → click `GET /api/products`. Waterfall: **Nginx → product-N → MongoDB find**. Point out that the browser never talks to the database.
4. Show the same thing from a terminal:
   ```bash
   curl -i "http://localhost:8080/api/products?q=iphone"
   ```
5. **Invalid requests and status codes**:
   ```bash
   curl -s "http://localhost:8080/api/products?limit=500&page=0"     # 400 VALIDATION_ERROR, details per field
   curl -s "http://localhost:8080/api/products?colour=red"           # 400: unknown parameter (strict API)
   curl -s  http://localhost:8080/api/products/does-not-exist        # 404 PRODUCT_NOT_FOUND
   curl -s  http://localhost:8080/api/cart                           # 401 AUTH_REQUIRED
   curl -s -X POST http://localhost:8080/api/auth/login -H 'content-type: application/json' -d '{"email":'   # 400 INVALID_JSON
   curl -s  http://localhost:8080/api/nothing                        # 404 from the gateway itself
   ```
   Every error has the same envelope: `{ "error": { "code", "message", "details", "requestId" } }`.
6. Open http://localhost:8080/api-docs/ and show the contract (and "Try it out").

**Discussion**
* Which of these errors should a UI test catch, and which an API test? Why test the API at all if the UI works?
* What's the difference between 400, 401, 403, 404 and 422 here?
* Why does an empty search return `200` with `[]` instead of `404`?

---

## Demo 2: Monolith vs microservices

**Goal:** service boundaries, independent failure.

1. Dashboard → **Architecture**. Walk the diagram: one gateway, eight services, each with its own data store.
2. Toggle **Monolith (concept)** and compare: one deployable, one DB, in-process calls.
3. Back on Microservices, press **Full customer journey**. The step list replays the real hops (built from spans). Point at the order service talking to cart, product, inventory and payment.
4. **Partial failure:** Failure lab → switch on **Cart service down** (it really stops the container).
   * Shop: home, search and product pages still work.
   * Cart icon → friendly error. Add to cart → error box with the code.
   * Health page: `cart` DOWN, everything else UP.
5. Switch it off. Then switch on **Inventory service down**:
   * Product page still renders, but stock shows **"Availability unknown"** (the page is composed from two services).
   * Try checking out: `503 INVENTORY_UNAVAILABLE` and **no payment attempt** (trace stops at inventory).
6. Switch it off.

**Discussion**
* In a monolith, what would a crash in "notifications" do to checkout?
* What did we gain? (independent deploy, scale, fault isolation) What did we pay? (network failures, distributed data, harder debugging)
* Which tests become *more* important with microservices? (contract, integration, resilience)

---

## Demo 3: Load balancing

**Goal:** stateless instances, distribution, failover, recovery.

1. Dashboard → **Load balancer**. Three product instances with request counters.
2. Send a burst of **30** requests → the strip is coloured product-1, -2, -3 in rotation (round robin); 10 each.
   ```bash
   for i in $(seq 9); do curl -s -o /dev/null -D - http://localhost:8080/api/products?limit=1 | grep -i x-served-by; done
   ```
3. Click **Stop instance** on product-2 (a real `docker stop`). Send another burst:
   * All requests still succeed, served by product-1 and product-3.
   * The first one or two may take ~1 s: Nginx tried product-2, hit the connect timeout and retried on the next instance. The Nginx log table shows the upstream sequence (e.g. `product-2 → product-1`, status `502, 200`).
   * In rare cases a request right at the moment of shutdown fails. Ask: *who should retry?*
4. **Start instance** product-2. Within ~5 s (DNS re-resolution) it receives traffic again.
5. Failure lab → **One slow instance**. Burst again: every third request is slow (🐢), but Nginx keeps sending traffic there. Health shows product-2 DEGRADED.
6. Explain why only GETs are retried by the gateway (`proxy_next_upstream` without `non_idempotent`).

**Discussion**
* Why can product run as 3 instances but the order service here can't (yet)? (state: the outbox publisher and reconciler would race)
* What's the difference between passive and active health checks?
* How would you test that a load balancer is configured correctly before a sale?

---

## Demo 4: Redis caching

**Goal:** cache-aside, hits/misses, TTL, stale data, invalidation, graceful degradation.

1. Dashboard → **Cache**. Product `iphone-15-128`, press **GET** three times:
   * 1st: **MISS** (loaded from MongoDB, key appears in "Keys currently in Redis" with a TTL counting down from 60)
   * 2nd/3rd: **HIT**, possibly from *different* instances (the cache is shared).
   * Shop product page: the dark diagnostic badge shows `⚡ Product data: HIT · served by product-3`.
2. **Invalidation:** set a new price (e.g. 74900) → message "Cache invalidated: YES" → GET → **MISS** with the new price.
3. **Stale cache:** Failure lab → **Stale cache (invalidation disabled)**. Change the price again → GET → **HIT with the OLD price**. Refresh the shop product page: still old.
   * Now check out the product in the shop. The order total uses the **new** price and the checkout response contains `priceChanges`. *The cache is never trusted for money.*
   * Press **Invalidate** → fresh price.
4. **TTL expiry:** Failure lab → **Short cache TTL (10s)**. GET, watch the TTL bar drain, GET again after 10 s → MISS.
5. **Redis down:** Failure lab → **Redis unavailable** (stops the container). Product pages still work with `X-Cache: BYPASS` (slower, straight from MongoDB). Health: product instances **DEGRADED**, not DOWN.
6. Reset the price: `./scripts/reset.sh` (or set it back to 69900).

```bash
./scripts/shell.sh redis
> KEYS product:*
> TTL product:iphone-15-128
> GET product:iphone-15-128
```

**Discussion**
* What's the worst case of a stale cache in e-commerce? Which data must never come from a cache?
* How would you test TTL without waiting 60 s in CI? (configurable TTL, test hooks)
* What happens to the database when the cache goes down during the Diwali peak? (cache stampede)

---

## Demo 5: SQL vs NoSQL

**Goal:** structured relational data and transactions vs flexible documents. Concurrency.

1. Dashboard → **Data (SQL / NoSQL)**:
   * `Orders` → `Order items (FK → orders)` → `Order status timeline`: relational, normalised, foreign keys.
   * `Product documents` (MongoDB): open the iPhone (has `specs.chip`) and the kurta (no `specs`, has `variants.size`). Same collection, different shapes.
   * The query used is shown above each table.
2. **Referential integrity / constraints** (in a SQL shell):
   ```bash
   ./scripts/shell.sh psql inventory_db
   \d stock                       -- CHECK (available >= 0)
   ./scripts/shell.sh psql order_db
   \d order_items                 -- FOREIGN KEY ... REFERENCES orders(id)
   \d orders                      -- UNIQUE (user_id, idempotency_key)
   ```
   (The read-only user can't write. Ask students what *should* happen if you insert an order item for a non-existent order.)
3. **Transaction and rollback:** in the shop, put **Brass Pooja Thali** *and* **Dyson V12** (stock 0) in one cart and check out:
   * `409 OUT_OF_STOCK`, order REJECTED.
   * Trace → inventory: `BEGIN`, `UPDATE stock` (thali OK), `UPDATE stock` (Dyson, 0 rows), **`ROLLBACK`**.
   * Data → Stock: thali quantity unchanged. *All or nothing.*
4. **Concurrent stock updates:** Dashboard → **Guided demos** → *Two customers buy the LAST unit*:
   * **Run (correct code)** → exactly one 201, one 409. Stock 0, sold +1.
   * **Run with the race-condition BUG** → **both** succeed: **oversold**. Explain read-modify-write vs the atomic `UPDATE … WHERE available >= qty` (row lock).
5. **Consistency across services:** after an order, `stock.reserved` drops and `sold` rises a moment later, when the `OrderCreated` event is consumed. That's eventual consistency between services, built on strong consistency inside each database.

**Discussion**
* Could MongoDB have prevented the oversell? (Yes: atomic conditional updates and transactions exist. The *pattern* matters.)
* Why does `orders` have a UNIQUE `(user_id, idempotency_key)`?
* How would you write a test that reliably reproduces a race condition?

---

## Demo 6: Messaging queue

**Goal:** producer, consumer, queue, delays, failures, retries, duplicates, idempotency, DLQ.

1. Dashboard → **Messaging**: the order service publishes `OrderCreated` to the `shop.events` exchange, and three queues each receive a copy.
2. Place an order. The trace shows `publish order.created` then three `consume …` spans that arrive *after* the HTTP response (async). The shop order page shows "Confirmation email ⏳ Queued", then the e-mail appears.
3. **Consumer unavailable:** Messaging → **Pause consumer** (or Failure lab → *Notification consumer stopped*). Place two orders:
   * Checkout is still instant and CONFIRMED.
   * `notification.order-created` → **ready 2**, highlighted in amber.
   * **Resume** → the backlog drains, notifications appear.
   * Harder version: `docker compose stop notification` and later `docker compose start notification`.
4. **Delayed processing:** Failure lab → *Slow notification processing* (10 s). Checkout latency doesn't change; the consumer span is 10 s long.
5. **Retry and DLQ:** Failure lab → *Notification processing fails*. Place an order:
   * Logs: `will retry` (attempt 1), 5 s later attempt 2, then `moving to dead-letter queue`.
   * Messaging → DLQ count 1 → **Peek DLQ** shows the payload, error and attempts.
   * Switch the fault off → **Re-drive DLQ** → the notification appears.
6. **Duplicate delivery + idempotent consumer:** Failure lab → *Duplicate message delivery*, place an order (or Messaging → **Re-deliver last event**):
   * Logs: `Duplicate OrderCreated event ignored`, `Duplicate OrderCreated ignored (reservation already committed)`.
   * Data → Notifications: still **one** per order.
7. **Broker down:** Failure lab → *Message broker down*. Place an order: still CONFIRMED. Data → Outbox: row with `published_at = NULL`. Switch it off: the outbox publisher delivers automatically, and the notification arrives.

**Discussion**
* What should happen to the order if the e-mail provider is down for an hour?
* "At-least-once" delivery means duplicates. How do you test idempotent consumers?
* Why write the event to an outbox table instead of publishing directly after `COMMIT`?
* How do you monitor a DLQ in production? Who owns re-driving it?

---

## Demo 7: Distributed systems and failures

**Goal:** timeouts, partial failure, retries, idempotency, recovery, eventual consistency.

### 7a. The classic: charged, but the response timed out
1. Explain the problem on the whiteboard: *the order service asks payment to charge ₹20,900. The charge succeeds. The response is lost. Was the customer charged? Should we retry?*
2. Dashboard → **Guided demos** → *Charged, but the payment response timed out* → **Run**. Or manually: Failure lab → *Payment response timeout*, then check out in the shop.
3. Show:
   * The order is CONFIRMED after ~3.3 s.
   * The trace: `payment attempt 1/3` ends with **timeout**, `payment attempt 2/3` returns quickly with `replayed`.
   * Data → Payments: **one row**, `request_count = 2`.
   * Shop order page → Payment card: "Requests received for this charge: 2".
4. Why it's safe: same idempotency key (`pay_<orderId>`), UNIQUE in the payment DB, `INSERT … ON CONFLICT` returns the original result.

### 7b. When even retries time out: reconciliation and eventual consistency
1. Failure lab → *Every payment reply times out*. Check out in the shop.
2. After ~10 s the shop shows **"We are confirming your payment"** (HTTP 202, PAYMENT_PENDING). Stock stays reserved.
3. Switch the fault off (or leave it on, since the reconciler reads by key, which isn't delayed). Within ~15-20 s the page flips to **Confirmed** by itself. The order timeline says *"Payment confirmed by reconciliation"*, and the reconcile span joins the **same trace**.

### 7c. Other failures
* *Payment service unavailable* → `503 PAYMENT_UNAVAILABLE`, 3 fast retries in the trace, reservation **RELEASED**, coupon usage returned, cart kept.
* *Payments declined* → `402`, compensation (release stock, return coupon).
* *Duplicate order request*: Guided demos → **Run**: A = 201, B = 409 `REQUEST_IN_PROGRESS`, C (retry) = 200 replay. One order, one payment.
* Manual fault injection (bottom of the Failure lab): add latency / error rate / 503 to any instance and watch the health status and traces.

**Discussion**
* List every place in checkout where a retry could cause a duplicate. Which ones are protected and how?
* Why is `202 Accepted` the honest answer in 7b?
* What should a support agent see when a customer asks "was I charged?"

---

## Diwali sale (capstone demo)

1. Guided demos → **Start Diwali sale** (or `./scripts/sale.sh on`):
   * Sale prices (iPhone 15 → ₹59,900), shop hero turns festive, *Today's Deals* filled.
   * Limited stock: iPhone 15 = 5, boAt Airdopes = 10, Samsung QLED TV = 3.
   * `DIWALI50` active (50% up to ₹2,000, once per customer, 100 uses).
2. Run the local load test while the dashboard is open on **Load balancer**, **Cache** and **Messaging**:
   ```bash
   cd tests && npm run load
   ```
   Teardown prints `OK … units sold during the sale 5` for each limited deal: no overselling while ~40 virtual users browse and buyers compete.
3. Discuss: what would change for **100,000 concurrent users**? (See STUDENT_ASSIGNMENTS.md → scaling guidance.)
4. `./scripts/sale.sh off` and `./scripts/reset.sh`.

---

## Fault-injection reference

| Failure lab switch | Mechanism (real) | Expected behaviour |
|---|---|---|
| Payment service unavailable | `docker stop qamart-payment` | 503, nothing charged, stock released, browsing OK |
| Payment response timeout | payment commits, replies after 8 s (first request) | retry with same key, one charge, `request_count=2` |
| Every payment reply times out | all replies delayed | 202 PAYMENT_PENDING → reconciler confirms |
| Payments declined | force decline | 402, compensation |
| Notification consumer stopped | consumer cancelled | order OK, queue backlog grows, drains on resume |
| Notification processing fails | consumer throws | 3 attempts → DLQ → re-drive |
| Slow notification processing | +10 s per message | async delay, checkout unaffected |
| Duplicate message delivery | every event published twice | consumers ignore duplicates |
| Redis unavailable | `docker stop qamart-redis` | BYPASS to MongoDB, DEGRADED health |
| Backend instance stopped | `docker stop qamart-product-2` | failover to product-1/3, recovery on start |
| One slow instance | +1.5 s on product-2 | round robin still sends 1/3 there |
| Cart / Inventory down | `docker stop` | partial failure, friendly errors |
| Unsafe stock update | read-modify-write bug | race demo oversells |
| Message broker down | `docker stop qamart-rabbitmq` | outbox keeps events; delivered on recovery |
| Stale cache | invalidation off, TTL 120 s | old price shown, checkout uses DB price |
| Short cache TTL | TTL 10 s | MISS after expiry |

All of these are reset by `./scripts/reset.sh`.

## Inspecting things by hand

```bash
./scripts/shell.sh logs <request-id>                         # one request across all services
docker compose logs -f order notification                   # live logs
./scripts/shell.sh psql payment_db -c "SELECT idempotency_key, status, request_count FROM payments ORDER BY created_at DESC LIMIT 5;"
./scripts/shell.sh mongo notification_db --eval 'db.notifications.find().sort({createdAt:-1}).limit(3)'
curl -s http://localhost:8081/lab/api/health | jq             # same data as the Health page
```

RabbitMQ console: http://localhost:15672 → Queues (shows `x-dead-letter-*` arguments).

## If something goes wrong while recording

| Problem | Fix |
|---|---|
| A demo shows unexpected results | A previous fault is still on. Run `./scripts/reset.sh`. |
| A container stays stopped | Health page → *Start container*, or `docker compose up -d` |
| Shop says "unavailable" for ~5 s after starting a container | Nginx DNS re-discovery (valid=5s). Wait, or use it as a teaching moment. |
| Dashboard not updating | The "live" dot in the sidebar should be green; refresh the page. |
| Everything is messy | `docker compose down -v && docker compose up --build -d` (about 2 min) |
