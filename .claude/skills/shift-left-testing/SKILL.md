---
name: shift-left-testing
description: Rules and guidance for shift-left testing - assigning each test scenario to the lowest test layer that can prove it (unit, component integration, contract, system API, E2E UI), detecting overlap between layers, and producing a layered test plan with a pyramid summary. Use when asked to shift tests left, assign scenarios to test layers, review a test suite for the test pyramid, or find duplicated tests across layers.
---

# Shift-Left Testing: Layer Assignment Rules

Your job: take a list of test scenarios (written from requirements, or existing tests) and place each one in
the **lowest, cheapest test layer that can still catch the defect**, then flag duplication across layers.

Core principle: **the lowest layer that can prove a rule owns the full matrix of cases for it.
Higher layers only run a representative case that proves wiring or what the user sees.**

## The layers (lowest → highest)

| Code | Layer | Exercises | Real dependencies | Use for |
|---|---|---|---|---|
| **U** | Unit | One function/class in memory | None (stubs for any I/O) | Calculations, validation, mapping, branching, formatting, rule ordering |
| **I** | Component integration | One service through its API or repository layer | That service's **own** DB / cache / queue, real. Other services stubbed | Persisted state, DB constraints, transactions, locks, concurrency, cache behaviour, message consumers |
| **C** | Contract | The request/response agreement between a consumer and a provider service | None (contract files, provider verification) | Field names/types, status codes, error shapes between services |
| **S** | System API (E2E without UI) | Several real services via the gateway | Whole stack | Cross-service flows, compensation, distributed failures, async delivery, gateway/LB behaviour |
| **E** | E2E UI | Real browser on the real shop | Whole stack + browser | Critical customer journeys and what the customer **sees or does** |
| **N** | Non-functional | Load, performance, resilience at scale | Whole stack (or perf env) | Throughput, latency, error rate under load |

## Decision procedure

For each scenario ask these questions **in order** and stop at the first "yes":

1. **Pure logic?** Can the expected result be computed by calling one function with inputs and comparing outputs,
   with any I/O replaced by a stub without hiding the rule? → **U**
2. **One service + real datastore?** Does the rule depend on stored state from earlier calls, a DB constraint, a
   transaction/rollback, a row lock, concurrent requests, a cache hit/miss/invalidation, or a queue consumer, **all
   inside one service**? → **I**
3. **Interface between two services?** Is the risk that one service changes a field, type, status code or error
   shape another service relies on? → **C**
4. **Several services must cooperate?** Does it need two or more real services, the gateway/load balancer, a
   failure *between* services (timeout, service down, broker down), compensation, or eventual consistency? → **S**
5. **The browser is part of the requirement?** Is a message, page state, enabled/disabled control, navigation or
   the whole customer journey the thing being verified? → **E**
6. **Volume or timing at scale?** → **N**

### Hard rules

* **R1. Don't mock what you're testing.** If the rule *lives in* the SQL, the lock, the unique constraint or the
  cache, a unit test with that dependency mocked proves nothing. Go to **I**.
* **R2. Business rules never get their full matrix in E.** A UI test may show *one* coupon, *one* invalid field,
  *one* error message. All other values go down to U/I.
* **R3. Boundary and equivalence cases go to the lowest layer.** min−1 / min / max / max+1, rounding, empty, null,
  format variants → U (or I if the boundary is enforced by stored state).
* **R4. Concurrency needs a real datastore.** "Exactly one succeeds", "never oversold", "never twice" → at least **I**.
  Promote to **S** only if the race spans several services.
* **R5. Distributed failures are S.** Timeouts between services, retries across a boundary, service/broker down,
  reconciliation, outbox delivery → **S** (fault injection), not E, unless the UI's reaction is the requirement.
* **R6. "End-to-end" means scope, not clicking.** Prefer **S** over **E** when the browser adds nothing to the assertion.
* **R7. Keep E small.** Only business-critical journeys (the money path, the main failure the customer feels,
  release smoke). Aim for single digits per feature area.
* **R8. Security/authorisation:** token/role checks on one endpoint → **I**; "user A can't see user B's data
  through the gateway" → **I** if one service owns it, **S** if it spans services.
* **R9. Async results:** consumer idempotency/retry/DLQ logic → **I** (service + real broker); "order confirmed →
  email eventually arrives" → **S**, asserted by polling, never a fixed sleep.
* **R10. When unsure between two layers, pick the lower one** and note what the higher layer would add.

## Overlap rules

A rule may legitimately appear in several layers. Classify every multi-layer rule:

| Verdict | Meaning | Action |
|---|---|---|
| ✅ **Complementary** | Each layer proves something different (e.g. U = discount math, E = discount shown on screen) | Keep both. Higher layer keeps **one** representative case. |
| ⚠️ **Partial duplicate** | Higher layer repeats some of the lower layer's matrix | Trim the higher layer to one case, or re-aim it at what only it can prove (e.g. "no order created" rollback). |
| ❌ **Pure duplicate** | Higher layer asserts exactly what a lower layer already proves, with no extra wiring or UI value | Remove from the higher layer. |

Also flag the **opposite** gap: a rule that only exists in a high layer (E/S) but whose logic could be tested lower.
That's a **shift-left opportunity**.

## Output format

Produce these sections, in this order.

### 1. Layer assignment table

| Scenario ID | Scenario | Req ID | Layer | Rule used | Why this layer | Why not lower |
|---|---|---|---|---|---|---|

* `Layer` is one of `U`, `I`, `C`, `S`, `E`, `N`.
* `Rule used` cites the decision question (Q1-Q6) and/or hard rule (R1-R10).
* `Why not lower` must be filled for every I/C/S/E/N row. If you can't justify it, move the scenario down.
* If a scenario bundles several rules (e.g. "valid and invalid coupons"), **split it** into rows before assigning.

### 2. Overlap analysis

| Rule / requirement | Layers where it appears | What each layer proves | Verdict (✅/⚠️/❌) | Action |
|---|---|---|---|---|

### 3. Shift-left opportunities

Scenarios (or existing tests, if given) that are in a higher layer than needed: current layer → recommended layer,
and the one-line reason.

### 4. Pyramid summary

Count of scenarios per layer, plus a text pyramid:

```
E  ██            2
S  ████          4
C  ██            2
I  ████████      8
U  ████████████ 12
```

Comment on the shape: is it a pyramid, or an ice-cream cone (more E/S than U/I)? Say what to change.

### 5. Open questions

Anything where the requirement didn't give enough detail to choose a layer (e.g. "is the 30 s reconciliation an SLA we
must verify?").

## Worked examples (QAMart)

| Scenario | Layer | Reasoning |
|---|---|---|
| `WELCOME10` on ₹69,900 gives ₹1,000 (cap applied) | **U** | Q1: pure arithmetic on subtotal + coupon definition. R3 |
| `DIWALI50` on ₹998 → `COUPON_MIN_SUBTOTAL` | **U** | Boundary of a value rule. R3 |
| Expired coupon below minimum reports `COUPON_EXPIRED` first | **U** | Branch order. Coupon row is stubbed; the rule is the `if` order, not the DB |
| Pincode `060038` rejected | **U** | Regex validation. R3 |
| Stock 5 → `LOW_STOCK`, 6 → `IN_STOCK` | **U** | Threshold mapping |
| Add 6 then 5 of one product → `422 CART_LIMIT_EXCEEDED` | **I** | Q2: limit spans two requests, so stored state. Not U: the per-request schema alone (1-10) allows both adds |
| Two buyers, one unit, same moment → exactly one order | **I** | R1 + R4: the guarantee is the atomic SQL update; mocking the DB hides it |
| `LIMITED1` redeemed concurrently by two customers | **I** | R4: row lock in `order_db` |
| Same `Idempotency-Key` twice → original order replayed | **I** | Q2: unique constraint in `order_db` |
| Idempotency-Key of 7 chars rejected | **U** | Format validation, R3. Not I: no state involved |
| Product read MISS then HIT; price update invalidates | **I** | Q2: Redis behaviour inside product service |
| Order service reads `paymentId` and `status` from Payment's response | **C** | Q3: inter-service agreement |
| Declined payment releases stock **and** coupon | **S** | Q4: compensation across order, inventory, payment |
| Payment times out after charging → retry → charged once | **S** | R5: failure between services |
| Broker down → order confirmed, email delivered later | **S** | R5 + R9 |
| Customer buys iPhone with `WELCOME10` and sees confirmation | **E** | Q5 + R7: critical money journey |
| Declined payment keeps customer on checkout with a clear message | **E** | Q5: what the customer sees. Compensation itself is already **S** |
| Invalid coupon message shown next to coupon field | **E** (one case) | Q5. All other `COUPON_*` codes are U (R2) |
| 10,000 users searching during the sale, p95 within target | **N** | Q6 |

### Overlap example

| Rule | Layers | What each proves | Verdict | Action |
|---|---|---|---|---|
| Coupon rejection codes | U (all 6 codes), S (`04-checkout` "coupon rules"), E (`ui/02` "invalid coupon") | U: each rule and order. S: same codes again. E: message displayed | ⚠️ | Keep U matrix + one E message check. Re-aim S at "invalid coupon ⇒ no order created, stock unchanged" (rollback), which U can't prove |
| Address validation | U (regex matrix), E (one field error shown) | Different things | ✅ | Keep. E stays one case |

## Workflow when invoked

1. If you were given requirements but no scenarios, ask whether to generate scenarios first (for QAMart, use the
   `qamart-requirements` skill and its scenario conventions).
2. Split bundled scenarios so each row tests one rule.
3. Assign each row using the decision procedure and hard rules. Fill `Why not lower`.
4. Group rows by requirement ID and run the overlap analysis.
5. If existing test files were given (e.g. `tests/api`, `tests/ui`), map each test to its recommended layer and list
   shift-left opportunities.
6. Produce the pyramid summary and open questions.
7. Don't write test code unless asked. This skill produces the **test plan**.
