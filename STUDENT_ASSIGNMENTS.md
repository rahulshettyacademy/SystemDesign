# Student Assignments: Testing QAMart for the Diwali Sale

> **Scenario.** QAMart is preparing for its Diwali sale. Marketing expects **100,000 concurrent users**, a handful of **limited-stock lightning deals**, **discount coupons**, **online payments** and **order-confirmation notifications**. You are the QA engineer responsible for proving the system is ready, or for finding out why it isn't.

You have the whole system on your laptop. Use the shop, the API (`/api-docs/`), the Teaching Dashboard, database shells and the sample tests in `tests/`.

### Ground rules
* Start every session with `./scripts/reset.sh`. Leave the lab clean (faults off) when you finish.
* Turn on sale mode with `./scripts/sale.sh on` when an exercise says *[sale]*.
* Prefer automated tests. Put new tests next to the samples (`tests/api`, `tests/ui`, `tests/load`).
* For every bug you find, write a short report: steps, expected, actual, **request ID**, evidence (trace / log / SQL row).
* Use the demo accounts `loadtest01…50@qamart.test` in automated tests so you don't collide with manual testing.

### How you'll be evaluated (every assignment)

| Criterion | Weight | What "excellent" looks like |
|---|---|---|
| Coverage of risk | 30% | Tests target the *system design* risks (concurrency, failure, consistency), not just happy paths |
| Correct oracles | 25% | Assertions check the right source of truth (DB row, queue depth, payment count), not just HTTP 200 |
| Determinism | 20% | Tests set up their own data, reset what they change, and handle eventual consistency with polling, not sleeps |
| Evidence & reporting | 15% | Bugs come with request IDs, traces and minimal reproduction steps |
| Code quality | 10% | Readable, reusable helpers; no copy-paste |

---

## A. Frontend testing

**Learning outcomes:** functional journeys, validation, error handling, async UI, cross-browser.

1. Automate the full journey for a *new* user path: browse a **category** → sort by price → add **two different** products → change quantity → apply `FLAT500` → check out with **demo_slow** → verify the order page and the e-mail card.
2. Write data-driven tests for checkout address validation (name, address, city, PIN code `^[1-9][0-9]{5}$`, mobile `^[6-9][0-9]{9}$`). Include boundaries (5/6/7 digits, leading 0).
3. Error handling: for each of `PAYMENT_DECLINED`, `OUT_OF_STOCK`, `COUPON_EXPIRED`, `PAYMENT_UNAVAILABLE`, assert the message shown and that the customer stays on a sensible page. (Hint: use the Failure lab or `setStock` from `tests/support/lab.ts`.)
4. Async UI: assert the order page goes from "Queued" to the e-mail **without** a hard wait (Playwright's auto-waiting `expect`).
5. **Cross-browser:** add `firefox` and `webkit` projects to `playwright.config.ts` and run the UI suite in all three. Report any differences.
6. Accessibility smoke check: every form field has a label; the cart badge updates for screen readers (bonus: `@axe-core/playwright`).

**Deliverable:** UI spec files plus a short note on which checks belong in UI tests and which in API tests.

## B. API testing

**Learning outcomes:** contracts, negative testing, authentication vs authorization, idempotency.

1. **Contract:** use `expectSchema()` to validate *every* endpoint in `docs/openapi.yaml`, including error responses. Then break the contract on purpose (e.g. rename a field in `backend/services/cart/src/index.ts`, rebuild `cart`) and show the test catching it.
2. **Negative matrix** for `POST /api/cart/items` and `POST /api/orders`: missing fields, wrong types, extra fields, huge strings, invalid JSON, wrong `Content-Type`. Record status and `error.code` for each.
3. **AuthN/AuthZ:** no token, malformed token, a token signed with the wrong secret, an expired token (craft one with `jsonwebtoken` and `exp` in the past). User A must not read user B's order, payments or notifications. Explain why 404 instead of 403.
4. **Admin-only:** `PATCH /api/products/:id` as customer vs admin; invalid prices (0, negative, decimal, string).
5. **Idempotency:** same `Idempotency-Key` → same order; same key with a *different* cart; keys that are too short or contain spaces. Is it a bug that a reused key with a different body returns the original order? Argue both sides.
6. **Coupons:** `LIMITED1` can be redeemed by only one customer. Try two customers in parallel. `DIWALI50` *[sale]* is once per customer; try twice in parallel with the same user.

## C. Microservices testing

**Learning outcomes:** integration points, partial failures, service compatibility.

1. Draw the call graph of `POST /api/orders` from a real trace (Dashboard → Request traces). List every synchronous dependency and its timeout.
2. For **each** dependency of checkout (cart, product, inventory, payment), stop it (Failure lab or `docker compose stop <svc>`) and record: HTTP status, error code, order status, whether stock/coupon were released, whether the customer was charged. Turn this into an automated test matrix.
3. Prove *partial* failure: with `cart` down, which pages still work? With `notification` down, does checkout still succeed?
4. **Compatibility:** the cart service stores `unitPrice` at add time. What happens if the product service starts returning prices with decimals? Write a test that would catch a breaking change between services (consumer-driven contract idea).
5. Inject 2,500 ms latency into `inventory` (manual fault injection). What does the customer experience? Is the order service's 3 s timeout appropriate?

## D. Load balancer testing

**Learning outcomes:** distribution, failover, recovery, the limits of round robin.

1. Verify even distribution over 30, 300 and 3,000 requests (`X-Served-By`). Allow a tolerance and justify it.
2. Stop `product-2` during a k6 run. Measure: how many requests failed, the maximum latency, and the time until no requests go to product-2. Start it again and measure the time to rejoin.
3. Make one instance slow (manual fault: `http.latencyMs=1500` on product-3). Show the effect on p50 vs p95 latency. Propose a better LB strategy (least connections, active health checks, outlier detection).
4. Make one instance return 503 (`http.unavailable`). Why does the customer never see it for GET requests? Would the same be true for POST?

## E. Cache testing

**Learning outcomes:** hit/miss behaviour, TTL, stale data, invalidation, cache failure.

1. Prove cache-aside: MISS then HIT (`X-Cache`), and that HITs come from multiple instances (shared cache).
2. TTL: set TTL to 5 s (Dashboard → Cache), and assert expiry with `X-Cache-TTL` instead of a fixed sleep.
3. Stale data: with invalidation disabled, change a price and show (a) the product page is stale and (b) checkout charges the correct price. Is (a) a bug? Under what business rules?
4. Redis down: functional correctness (BYPASS) **and** performance. Run the k6 smoke test with Redis up vs down and compare p95.
5. *[sale]* Starting the sale flushes the cache. Why? Write a test proving no product shows a non-sale price after the sale starts.

## F. Database testing

**Learning outcomes:** integrity, concurrent writes, rollback, consistency across services.

1. Using `./scripts/shell.sh psql`, document the constraints that protect data (`CHECK`, `UNIQUE`, `FOREIGN KEY`) in `inventory_db`, `order_db` and `payment_db`. For each, name the bug it prevents.
2. **Rollback:** a multi-item order where one item is out of stock. Prove (via SQL, before and after) that *no* stock changed.
3. **Concurrent writes:** extend `06-inventory-concurrency.spec.ts` to 50 buyers for 5 units. Then enable *Unsafe stock update* and show your test failing. This is the bug your test exists to catch.
4. **Consistency invariants:** write a SQL query (or test) that checks, for every product, `available + reserved + sold == initial stock + adjustments`. Run it after the k6 load test.
5. **NoSQL:** in MongoDB, find all products that have `specs.storage`, then all products with a `variants.size`. Explain why this flexibility helps the catalog and what new risks it creates for testers (missing fields, type drift).
6. **Cross-service consistency:** after an order, compare `order_db.orders`, `payment_db.payments`, `inventory_db.reservations` and `notification_db.notifications`. Write a "reconciliation report" test that flags any order whose four records disagree.

## G. Messaging queue testing

**Learning outcomes:** retries, duplicates, delays, failed-message handling, eventual consistency.

1. Show the full async path for one order using its request ID: publish → 3 consumes.
2. Consumer down: place 10 orders while the notification consumer is paused. Assert queue depth = 10, then resume and assert 10 notifications, **no duplicates**, and that every order stayed CONFIRMED.
3. Retries and DLQ: with the failure fault on, measure the time between attempts (logs) and confirm the 3rd failure lands in the DLQ with `x-attempts=3`. Re-drive and verify.
4. Duplicates: enable duplicate delivery and prove all three consumers are idempotent (notifications, reservations, cart).
5. Poison message: what happens if a malformed JSON message is published to `shop.events` with routing key `order.created`? (Publish one from the RabbitMQ console.) Is the behaviour acceptable?
6. Broker down: prove that orders placed while RabbitMQ is stopped still get notifications later (outbox), and measure the delay.

## H. Distributed systems testing

**Learning outcomes:** timeouts, idempotency, recovery, concurrency, eventual consistency.

1. **The classic:** automate "charged but the response timed out" and assert exactly **one** payment row with `requestCount = 2`.
2. Every reply times out: assert `202 PAYMENT_PENDING`, then poll until CONFIRMED. What is the maximum time a customer waits? Where is that number configured?
3. Turn off the timeout fault **before** the reconciler runs vs **after**. Is the outcome the same?
4. Find a window where a customer could be charged but the order ends up `PAYMENT_FAILED`. (Hint: look at what happens when payment returns `404` to the reconciler, and the 60 s rule.) Write it up as a risk with a test idea.
5. Concurrency: the same user clicks "Place order" from two browser tabs with **different** idempotency keys. What happens? Is that correct?
6. Recovery drill: stop `order` in the middle of a k6 run, start it again. Do any orders stay stuck in `PENDING` or `PAYMENT_PENDING`? (A real bug class: write it up.)

---

## Capstone: Diwali sale readiness report *[sale]*

Work in a team of 2-3.

1. `./scripts/sale.sh on`. Explore the sale: prices, limited stock, `DIWALI50`.
2. Run `tests/load/diwali-sale.js` (local profile). Collect: throughput, p95 per endpoint, error rate, orders confirmed vs sold out, and the oversell check in the teardown output.
3. Repeat with **one failure** of your choice injected mid-run (Redis down, product-2 down, notification paused, payment slow). Compare.
4. Write a **test strategy** for the real sale (100,000 concurrent users) covering every section above, plus a **go/no-go checklist**.
5. Present: top 5 risks, the evidence you collected, and what you would test in a production-like environment.

**Deliverables:** test code, k6 results (`k6 run --summary-export=summary.json …`), a 2-page readiness report.

---

## Scaling the performance tests beyond a laptop

The local profile (≈40 browsing VUs + a few buyers per second) is meant to be **reproducible**, not realistic. One laptop runs 15 containers and the load generator. Results are useful for **comparisons** (before/after a fault, cache on/off), not as absolute capacity numbers.

To approach 100,000 concurrent users:

1. **Model the traffic, don't guess it.** Concurrent users aren't requests per second. With ~5 s think time, 100k users ≈ 20k req/s, mostly reads (search/product). Buyers are a small fraction, but they hit the contended write path.
2. **Use a production-like environment:** separate machines/pods for each service, real managed databases, the same instance types and limits as production. Never load-test production during the sale.
3. **Distribute the load generator:** k6 can run in Kubernetes (k6-operator) or k6 Cloud. Locust and Gatling are alternatives. One generator node manages roughly 5-10k VUs, depending on the script.
4. **Ramp in stages** (10% → 25% → 50% → 100% → 150%) and hold each stage. Find the **knee** where latency rises.
5. **Test the sale's specific shape:** a spike at 00:00 when deals open (`ramping-arrival-rate` with a near-vertical stage), cache cold start right after sale prices change, and many buyers for the same 5 units.
6. **Observe everything:** RED metrics per service (rate, errors, duration), DB connections and locks, Redis hit ratio, queue depth and consumer lag, LB upstream health.
7. **Scale the bottlenecks you find:** more product instances (stateless), read replicas, a bigger cache, more consumers per queue, a separate pool for checkout, rate limiting / virtual waiting room at the edge.
8. **Define pass criteria up front,** e.g. p95 browse < 300 ms, p95 checkout < 2 s, error rate < 0.5%, **zero oversold units**, **zero double charges**, notification lag p95 < 60 s.
