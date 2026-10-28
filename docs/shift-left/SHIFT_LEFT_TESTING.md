# Shift-Left Testing: Teaching Notes (QAMart)

Module goal: students learn **which layer a test belongs in**, and why moving tests "left"
(towards unit and integration tests) gives faster, cheaper and more reliable feedback than
testing everything through the browser.

Everything here uses QAMart: the same shop, rules and services the earlier modules used.

---

## 1. What is shift-left testing?

Draw the delivery timeline from left to right:

```
Requirements → Design → Code → Unit tests → Integration / API tests → E2E / UI tests → Release → Production
   ◄──────────────────────────────  shift left  ──────────────────────────────
```

**Shift-left testing** means finding defects **as far left on that line as possible**:

1. **Earlier in time.** QA reviews requirements and designs, asks "how will we test this?"
   before code exists, and writes scenarios from the requirement document (what we'll do with Claude Code).
2. **Lower in the test stack.** A rule is checked by the **smallest test that can prove it**:
   a unit test instead of an API test, an API test instead of a browser test.

It doesn't mean "no E2E tests" or "developers do all the testing". It means each test lives in
the **cheapest layer that can still catch the bug**, and E2E tests are kept for what only E2E can prove.

## 2. The test layers (as used in QAMart)

| Layer | What it exercises | QAMart example | Typical speed | Needs running system? |
|---|---|---|---|---|
| **Unit** | One function or class, in memory. No network, DB, or Docker | `evaluateCoupon` discount math, cart quantity validation, stock status (`LOW_STOCK` when ≤ 5) | ~1-10 ms | No |
| **Component / service integration** | One service + its **real** dependencies (its DB, Redis, queue); other services stubbed | Cart service + Postgres: limit of 10 across several adds; inventory atomic reservation under concurrency | ~50-500 ms | Only that service + its DB |
| **Contract** | The agreement between two services (request/response shape, status codes) | Order → Payment `POST /internal/payments` returns `paymentId` + `status`; product response has the fields cart needs | ~10-100 ms | No (contract files / stubs) |
| **System API (end-to-end over HTTP)** | Several real services through the gateway | Checkout: cart → inventory → payment → order → RabbitMQ → notification | ~0.5-5 s | Yes, whole stack |
| **E2E UI** | A real browser driving the real shop | `tests/ui/01-customer-journey.spec.ts`: search → cart → coupon → pay → confirmation | ~5-30 s | Yes, whole stack + browser |

> The numbers are rough orders of magnitude for this lab on a laptop, not benchmarks. The
> point is the **ratio**: a UI test is commonly 1,000× slower than a unit test checking the same rule.

## 3. Why shift left? (the advantages)

### 3.1 Lower cost of a defect
The later a bug is found, the more it costs: more people are involved, more code is built on top of it,
and it may already have reached customers.

| Found at… | Who is involved | What it costs |
|---|---|---|
| Requirement review | BA + QA | Edit a sentence |
| Unit test | 1 developer, minutes | Fix + re-run in seconds |
| API / integration test | Dev + QA, CI pipeline | Reproduce, debug across services, redeploy |
| E2E / UI test | Dev + QA + env owner | Flaky reruns, environment debugging, test-data cleanup |
| Production | Customers, support, on-call, management | Refunds, reputation, incident review |

QAMart example: **`DIWALI50` gives 50 % but should be capped at ₹2,000.** If the cap is missing:
* Unit test on `evaluateCoupon(subtotal = 10000)` fails in **milliseconds**, the dev fixes it before pushing.
* UI test only fails if someone happened to buy a > ₹4,000 item during the sale.
* In production, every sale order above ₹4,000 is under-charged. Real money is lost.

### 3.2 Faster feedback
* Unit suite: hundreds of tests in **seconds**, on every save.
* API suite: minutes, needs Docker up.
* UI suite: tens of minutes as it grows, usually only in CI.

Fast tests get run often, so bugs are found minutes after they're written, while the code is still fresh in the developer's mind.

### 3.3 Exact failure location
A failing unit test says *"`evaluateCoupon` returned 5000, expected 2000"*.
A failing UI test says *"Expected text '₹68,900' not found"*. Was it the coupon? Cart? Price cache? The UI?
Lower tests point at the broken line. Higher tests only tell you something is wrong.

### 3.4 Less flakiness
UI tests depend on timing, rendering, network, seed data and 10+ containers.
Unit tests depend on nothing. Fewer moving parts means fewer false failures and less "just re-run it".

### 3.5 Better coverage of edge cases
Coupon rules alone have 6 rejection codes × 5 coupons × boundary values. That's easily 30+ cases.
* As unit tests: 30 cases in 50 ms, trivially.
* As UI tests: 30 × (log in, search, add to cart, open checkout, type coupon) = many minutes and a lot of fragile code.
Nobody writes 30 UI tests, so in practice **the edge cases go untested** unless they are shifted left.

### 3.6 Cheaper environments
Unit and contract tests need no Docker, no seeded databases and no shared QA environment, so they run on every laptop and every pull request.

## 4. The test pyramid vs the ice-cream cone

```
      Healthy pyramid                    Ice-cream cone (anti-pattern)
         /\   few E2E                     ███████████  many manual / UI tests
        /  \                               █████████   many API tests
       /----\  some API / contract           █████      few integration
      /      \                                ██        almost no unit tests
     /--------\ many integration               ▼
    /----------\ lots of unit tests
```

**Class exercise:** look at QAMart's `tests/` folder. It has **only** API (`tests/api`) and UI (`tests/ui`) tests,
and **no unit tests**. It's a lab built to *show the system*, so that's deliberate, but it's also a perfect
"before" picture. By the end of this module students should be able to say which of those tests could move down.

## 5. Scenarios by layer, from QAMart

### 5.1 Unit-level scenarios (pure logic: move these down)

These rules are decided by **one function with inputs and outputs**. Testing them through the browser
proves nothing extra.

| # | Scenario | Code under test | Why unit |
|---|---|---|---|
| U1 | `WELCOME10` on ₹69,900 → discount ₹1,000 (10 % capped at max) | `evaluateCoupon` discount formula | Pure arithmetic |
| U2 | `WELCOME10` on ₹5,000 → ₹500 (cap not reached) | same | Boundary of the cap |
| U3 | `DIWALI50` on ₹999 → ₹499 (floor of 50 %), on ₹998 → `COUPON_MIN_SUBTOTAL` | same | Boundary + rounding |
| U4 | `FLAT500` never discounts more than the subtotal | same | Guard rule |
| U5 | Coupon code `" welcome10 "` is accepted (trim + case-insensitive) | code normalisation | String handling |
| U6 | Rule order: a coupon that is both expired *and* below its minimum reports `COUPON_EXPIRED` first | `evaluateCoupon` check order | Branch logic (coupon row stubbed) |
| U7 | Cart quantity 0, 11, 2.5, "3" rejected; 1 and 10 accepted | zod schema in cart service | Input validation |
| U8 | Pincode `^[1-9][0-9]{5}$`: `560038` ok, `060038` / `56003` / `5600381` rejected | checkout address schema | Regex |
| U9 | Phone `^[6-9][0-9]{9}$`: `9876543210` ok, `5876543210` rejected | checkout address schema | Regex |
| U10 | Stock status: 0 → `OUT_OF_STOCK`, 5 → `LOW_STOCK`, 6 → `IN_STOCK` | inventory `view()` | Threshold mapping |
| U11 | Idempotency-Key: 7 chars rejected, 8 ok, 100 ok, 101 rejected, `abc$defgh` rejected | key validator | Format rules |
| U12 | Price-change detection: cart price ≠ catalog price → listed in `priceChanges` | checkout `priceChanges` filter | List transformation |
| U13 | Order totals: `total = subtotal − discount`, `lineTotal = unitPrice × quantity` | totals calculation | Arithmetic |

**Teaching line:** *"If you can test it without starting Docker, you should."*

### 5.2 Integration-level scenarios (need a real DB/cache/queue, but not the whole shop)

These rules depend on **state or concurrency inside one service and its datastore**. A unit test with mocks
would pass even if the SQL is wrong, so we need a real dependency. But we don't need the browser or the other 8 services.

| # | Scenario | Real dependency | Why integration, not unit | Why not E2E |
|---|---|---|---|---|
| I1 | Adding 6 then 5 of the same product → `422 CART_LIMIT_EXCEEDED` | Cart + Postgres | Limit spans two requests (stored state) | No UI or other service involved |
| I2 | Carts are isolated per user | Cart + Postgres | Query filtering by `user_id` | Same |
| I3 | Two concurrent reservations for the last unit → exactly one succeeds | Inventory + Postgres | Atomic `UPDATE … WHERE available >= n` can only be proven against a real DB | Browser can't create a true race |
| I4 | Multi-item reservation where item 2 is short rolls back item 1 | Inventory + Postgres | Transaction behaviour | Same |
| I5 | `LIMITED1` redeemed twice concurrently → one `COUPON_EXHAUSTED` | Order + Postgres (`FOR UPDATE`) | Row lock behaviour | Same |
| I6 | `DIWALI50` second use by same customer → `COUPON_ALREADY_USED` | Order + `coupon_redemptions` table | Needs persisted history | Same |
| I7 | Same `Idempotency-Key` twice → one order, second call `200 Idempotent-Replay` | Order + `UNIQUE (user_id, key)` | DB constraint | Same |
| I8 | Product read is `MISS` then `HIT`; admin price update invalidates | Product + Redis | Cache behaviour | Same |
| I9 | Duplicate `OrderCreated` delivery → one notification | Notification + RabbitMQ + Mongo | Idempotent consumer | Same |
| I10 | Order → Payment request/response shape | **Contract test** | Agreement between 2 teams | Breaks long before E2E would notice |

### 5.3 Typical end-to-end scenarios (keep these at the top)

Only E2E can prove that **all the pieces are wired together** and that the **customer experience** works.
Keep this list **short** and focused on business-critical journeys.

| # | Scenario | Why it must be E2E |
|---|---|---|
| E1 | Happy path: log in → search "iphone" → add to cart → apply `WELCOME10` → pay → confirmation → order in history → notification received | The money journey: proves every service, the gateway and the UI work together |
| E2 | Declined payment: customer stays on checkout, sees a clear message, cart is kept, stock & coupon released | Cross-service compensation + what the user sees |
| E3 | Inventory service down: product page still renders with stock "unknown" | Graceful degradation is a UI + system behaviour |
| E4 | Payment timeout after charge → retry with same key → charged once, order confirmed | Distributed failure across order, payment and reconciler |
| E5 | Broker down at checkout → order still confirmed; email arrives after broker returns | Outbox + async delivery across 3 components |
| E6 | Diwali sale smoke: sale price shown in UI, `DIWALI50` accepted, sale order completes | Release-day confidence check |

Notice E4/E5 are **system-level API tests**, not browser tests. "End-to-end" is about the *scope* (all services),
not about clicking buttons. Use the UI only when the UI itself is part of what you're proving.

### 5.4 Overlapping scenarios (the same rule in two layers)

Some rules legitimately appear in more than one layer. Overlap is fine **when each layer proves something different**.
It's waste when a higher layer re-runs the full matrix a lower layer already covers.

| Rule | Lower layer covers… | Higher layer covers… | Verdict |
|---|---|---|---|
| Coupon discount (`WELCOME10`, `DIWALI50`, `FLAT500`…) | **Unit:** every coupon, every boundary, rounding, caps (U1-U6) | **E2E:** *one* coupon applied, total shown correctly on screen (E1) | ✅ Keep both. E2E proves wiring; unit proves the math. **Remove** any UI test per coupon rule. |
| Checkout address validation | **Unit:** full regex matrix (U8, U9) | **UI:** *one* invalid field shows the server error next to that field (`tests/ui/02…` "server-side validation errors…") | ✅ Keep both, one UI case only |
| Invalid coupon rejected | **Unit:** each `COUPON_*` code | **API** `04-checkout` "coupon rules…" **and** **UI** `02-validation` "invalid coupon…" | ⚠️ Three layers for one rule. Keep unit (matrix) + one UI message check. The API case adds nothing unless it checks *"no order created"* (that's I-level rollback, keep that one). |
| Cart quantity limit | **Unit:** schema 1-10 per request (U7) | **Integration:** cumulative limit across adds (I1) | ✅ Different rules, not duplication: per-request vs. stored total |
| Out of stock | **Unit:** status mapping (U10) · **Integration:** atomic reservation (I3) | **UI:** Add-to-cart button disabled for OOS product | ✅ Each proves something different |
| Idempotency | **Unit:** key format (U11) · **Integration:** same key → replay (I7) | **E2E:** timeout + retry charged once (E4) | ✅ E4 is a distributed failure the lower layers can't reproduce |
| Wrong password | **Integration:** same 401 for wrong password/unknown user (`02-auth`) | **UI:** generic error shown (`ui/02`) | ✅ Keep both; UI only checks the message, not every credential combo |

**Rule of thumb for overlap:**
> The **lowest** layer owns the **full matrix** of cases.
> Every **higher** layer runs **one representative case** that proves the wiring or the user-visible result.

## 6. How to decide: the shift-left questions

Ask these in order. Stop at the first "yes".

1. **Can the rule be checked by calling one function with inputs and checking the output?** → **Unit**
2. **Does it need real state, a real DB constraint/lock/transaction, a cache or a queue, but only one service?** → **Component integration**
3. **Is it about the shape of a request/response between two services?** → **Contract**
4. **Does it need several real services to cooperate, or a failure *between* them?** → **System API (E2E without UI)**
5. **Is what the customer *sees or does* in the browser part of the requirement?** → **E2E UI**

Then check for **overlap**: if the same rule also appears higher up, keep only one representative case there.

## 7. Using Claude Code to do this (hands-on part)

This repo ships two Claude Code skills:

| Skill | File | What it holds |
|---|---|---|
| `qamart-requirements` | [`.claude/skills/qamart-requirements/SKILL.md`](../../.claude/skills/qamart-requirements/SKILL.md) | The QAMart requirement document: numbered requirements and acceptance criteria |
| `shift-left-testing` | [`.claude/skills/shift-left-testing/SKILL.md`](../../.claude/skills/shift-left-testing/SKILL.md) | Rules and guidance for putting each scenario in the right layer, handling overlap, and the output format |

Open Claude Code in the repo root and run the two steps.

**Step 1: generate scenarios from the requirements**
```
Using the qamart-requirements skill, write test scenarios for the Coupons and Checkout
requirements. Give each scenario an ID and the requirement ID it traces to. Don't assign layers yet.
```

**Step 2: shift them left**
```
Now use the shift-left-testing skill to put each of those scenarios into a test layer.
Show the layer table, the overlap analysis, and the pyramid summary.
```

**Discussion prompts for the class**
* Which scenarios did Claude put in a layer you disagree with? Argue it using the section 6 questions.
* How many UI tests did we end with vs. how many we'd write if everything were tested through the browser?
* Pick one existing test in `tests/ui` or `tests/api` and say where it should live. Is it duplicated elsewhere?

## 8. Common mistakes to call out

* **"Shift left = developers' job."** QA owns the *scenario design* and the layer decision, even if a developer writes the unit test.
* **Mocking the thing you're testing.** A unit test of the inventory SQL with a mocked DB proves nothing. That's why I3 is integration.
* **Testing business rules through the UI.** UI tests should check *display and interaction*, not recompute the coupon math.
* **No E2E at all.** Every layer can pass while the gateway route is misconfigured. Keep the few critical journeys.
* **Duplicating the matrix upward.** 30 coupon cases in unit **and** 30 in API **and** 30 in UI is triple the maintenance for no extra confidence.
