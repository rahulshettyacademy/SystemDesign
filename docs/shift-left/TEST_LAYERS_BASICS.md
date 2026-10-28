# Shift-Left Testing and the Test Layers (QAMart)

---

## 1. What is shift-left testing?

Picture the delivery timeline from left to right:

```
Requirements → Design → Code → Unit tests → Integration / API tests → E2E / UI tests → Release → Production
   ◄──────────────────────────────────  shift left  ──────────────────────────────────
```

**Shift-left testing** means finding defects **as far left on that line as possible**, in two ways:

1. **Earlier in time.** Testing starts at the requirement stage. QA reviews requirements and designs and asks
   *"how will we test this?"* before any code is written.
2. **Lower in the test stack.** Every rule is checked by the **smallest test that can prove it**:
   a unit test instead of an API test, an API test instead of a browser test.

Shift-left does **not** mean "no E2E tests" or "developers do all the testing". It means every test lives in
the **cheapest layer that can still catch the bug**, and E2E tests are kept for what only E2E can prove.

---

## 2. Why shift left?

### 2.1 Bugs are cheap on the left, expensive on the right

The later a bug is found, the more people it involves, the more code is built on top of it, and the more
likely it has already reached customers.

```
Cost of fixing a bug
  │                                                         ████  Production
  │                                                 ████
  │                                         ████            E2E / UI
  │                                 ████                    API / integration
  │                         ████                            Unit
  │                 ████                                    Code review
  │         ████                                            Requirement review
  └──────────────────────────────────────────────────────────────►  time
```

| Found at… | Who is involved | What it costs |
|---|---|---|
| Requirement review | BA + QA | Edit a sentence |
| Unit test | 1 developer, minutes | Fix and re-run in seconds |
| API / integration test | Dev + QA, CI pipeline | Reproduce, debug across services, redeploy |
| E2E / UI test | Dev + QA + environment owner | Flaky reruns, environment debugging, test-data cleanup |
| Production | Customers, support, on-call, management | Refunds, reputation, incident review |

### 2.2 It prevents catastrophic failures

QAMart example: **`DIWALI50` gives 50 % off but must be capped at ₹2,000.** Suppose the cap is missing:

* **Unit test** on the discount for a ₹10,000 order fails in **milliseconds**. The developer fixes it before pushing.
* **UI test** fails only if someone happens to test a product over ₹4,000 during the sale.
* **In production**, every sale order over ₹4,000 is under-charged on the biggest sales day of the year. Real money is lost,
  thousands of orders are affected, and nobody can take the discount back.

The same bug costs **one line of code** on the left and **an incident** on the right.

### 2.3 Faster feedback

* Unit suite: hundreds of tests in **seconds**, on every save.
* API suite: minutes, needs Docker running.
* UI suite: tens of minutes as it grows, usually only in CI.

Fast tests get run often, so bugs are found minutes after they're written, while the code is still fresh.

### 2.4 The failure points at the exact line

* A failing unit test says: *"discount returned 5000, expected 2000"*.
* A failing UI test says: *"Expected text '₹68,900' not found"*. Was it the coupon? The cart? The price cache? The UI?

Lower tests point at the broken line. Higher tests only say *something* is wrong.

### 2.5 Less flakiness

UI tests depend on timing, rendering, network, seed data and 10+ containers. Unit tests depend on nothing.
Fewer moving parts means fewer false failures and less "just re-run it".

### 2.6 Edge cases actually get tested

Coupon rules alone have 6 rejection codes × 5 coupons × boundary values: easily 30+ cases.

* As unit tests: 30 cases in about 50 ms.
* As UI tests: 30 × (log in, search, add to cart, open checkout, type coupon) = many minutes of slow, fragile tests.

Nobody writes 30 UI tests, so **edge cases go untested unless they are shifted left**.

---

## 3. The test pyramid: most tests at the bottom, few at the top

```
        Healthy pyramid                          Ice-cream cone (anti-pattern)

             /\        few E2E UI                ███████████████  many manual / UI tests
            /  \                                   ███████████    many API tests
           /----\      some system API               ███████      few integration
          /      \     contract tests                  ███        almost no unit tests
         /--------\    many component integration       ▼
        /----------\   lots of unit tests
```

**The rule:** most of the testing effort goes into **unit, component integration and contract tests**.
System API tests cover the important flows across services. **UI tests are the fewest**, kept only for the
critical customer journeys.

The six layers, from the bottom of the pyramid to the top:

```
          ▲  slower, costlier, fewer tests
          │   6. Non-functional    (how WELL it works: speed, load, security)
          │   5. E2E UI            (real browser, real user clicks)
          │   4. System API        (all services running, called over HTTP)
          │   3. Contract          (do two services agree on the "language"?)
          │   2. Component integ.  (one service + its real DB)
          │   1. Unit              (one function, in memory)
          ▼  faster, cheaper, many tests
```

For each layer the question is: **"What is the smallest thing I need to run to prove this?"**

---

## 4. Unit testing: "test one brick"

**Everyday example:** Before building a wall, you check **one brick**: is it the right size, is it unbroken?
You don't need the house, the plumbing or the electricity to check a brick.

**Simple code:** a calculator.

```ts
function add(a: number, b: number) { return a + b; }

test('2 + 3 = 5', () => expect(add(2, 3)).toBe(5));
```

No database, no network, no browser. Runs in **1 millisecond**.

**QAMart example:**
> *Scenario:* `WELCOME10` gives 10 % off, capped at ₹1,000. On a ₹69,900 phone the discount must be **₹1,000**, not ₹6,990.

The rule lives in **one line** of our code: [coupons.ts:26](../../backend/services/order/src/coupons.ts:26)

```ts
const discount = c.type === 'PERCENT'
  ? Math.min(Math.floor((subtotal * c.value) / 100), c.max_discount ?? Infinity)
  : Math.min(c.value, subtotal);
```

This is pure math: subtotal in, discount out. There is no reason to open a browser, log in, add to cart and
check out just to test a multiplication. That is a unit test.

```ts
test('WELCOME10 is capped at ₹1,000', () => {
  expect(calcDiscount({ type: 'PERCENT', value: 10, max_discount: 1000 }, 69900)).toBe(1000);
});
```

The formula currently sits inside `evaluateCoupon`, which also queries the database. To unit-test it, the
formula is extracted into a small `calcDiscount()` function. Code that is easy to unit-test is usually better-designed code.

More unit candidates in QAMart: stock status `LOW_STOCK` when ≤ 5
([inventory index.ts:65](../../backend/services/inventory/src/index.ts:65)), coupon code `" welcome10 "` → `WELCOME10`.

---

## 5. Component integration testing: "test the room, not the brick"

**Everyday example:** The bricks are fine. Now build **one room** and check that the door actually fits the frame
and the switch actually turns on the light. Real parts connected together, but just **one room**, not the whole house.

**Simple code:** the calculator now **saves its history to a real database**.

```ts
await calculator.addAndSave(2, 3);
expect(await db.query('SELECT result FROM history')).toEqual([{ result: 5 }]);
```

The math already works (the unit test proved that). Now we prove **code + real DB work together**.

**QAMart example:**
> *Scenario:* A customer can have at most **10** of one product in the cart, **even across several adds**
> (add 6, then add 5 → second add rejected with `422 CART_LIMIT_EXCEEDED`).

Code: [cart index.ts:68-70](../../backend/services/cart/src/index.ts:68)

```ts
const { rows } = await db.query('SELECT quantity FROM cart_items WHERE ...');  // what's already in the cart?
const newQty = (rows[0]?.quantity ?? 0) + body.quantity;
if (newQty > MAX_QTY) throw new ApiError(422, 'CART_LIMIT_EXCEEDED', ...);
```

The bug can only appear when the code **reads what's already stored in Postgres**. A unit test with no DB can't
see the "6 already in cart". But payment, inventory, nginx and the UI aren't needed either.
Start **only the cart service + its Postgres**, and stub everything else.

**Unit vs component integration:** unit = one function, nothing real around it. Component integration = one
service **plus its real dependencies** (DB, Redis, queue).

---

## 6. Contract testing: "do both sides speak the same language?"

**Everyday example:** You order a phone charger online. The phone maker says "USB-C". The charger maker says "USB-C".
A contract test checks that **the plug shape matches the socket**, without needing to charge a phone.
If the charger maker silently switches to micro-USB, the contract test fails **before** it ships.

**Simple code:** a calculator **app** calls a calculator **API**.

```
App expects:  { "result": 5 }
API returns:  { "answer": 5 }     ← both work alone, together they BREAK
```

Each side's own tests pass. Only a contract test catches the mismatch.

**QAMart example:**
> *Scenario:* Order service calls Payment service `POST /internal/payments` and reads `status` and `paymentId` from the reply.
> If Payment renames `status` → `paymentStatus`, every checkout breaks.

* Consumer (order) reads it: [checkout.ts:173](../../backend/services/order/src/checkout.ts:173) → `if (payment.status === 'SUCCEEDED')`
* Provider (payment) sends it: [payment index.ts:53](../../backend/services/payment/src/index.ts:53) → `res.status(201).json(view(payment))`

The contract pins down: *"request has `idempotencyKey, orderId, amount, method`; response has `paymentId` and
`status` ∈ {SUCCEEDED, DECLINED}"*. Each team checks against that agreement **independently, with no running stack**.

**Component integration vs contract:** component integration checks **one service with its own DB**.
Contract checks **the boundary between two services** (the shape of the message), not the logic inside them.

---

## 7. System API testing: "turn on the whole house and test from the front door"

**Everyday example:** All rooms are built and connected. Now walk in through the **front door**, switch on the main
power and check that water, lights and gas **all work together**. No guests yet (no UI), just the utilities.

**Simple code:** deploy the calculator app + DB + history service, then call it over HTTP.

```ts
const res = await request.post('/api/calc/add', { data: { a: 2, b: 3 } });
expect(res.status()).toBe(200);
```

**QAMart example:**
> *Scenario:* A **declined payment** must return `402`, mark the order `PAYMENT_FAILED`, **and give back** the
> reserved stock and the coupon.

This crosses **cart → product → order → inventory → payment** and back. No single service can prove
"stock was given back". It's a **flow across services**. Covered in:
[tests/api/04-checkout.spec.ts:61](../../tests/api/04-checkout.spec.ts:61)
`'declined payment: 402, order PAYMENT_FAILED, stock and coupon given back (compensation)'`

**Contract vs system API:** contract = "is the message shape right?" (no services running).
System API = "does the **whole flow** behave correctly?" (everything running, through the gateway).

---

## 8. End-to-end UI testing: "invite a real guest"

**Everyday example:** The house is ready. Now a **real person** walks in, finds the switch, reads the signs and makes tea.
Only a real guest can tell you "the switch is hidden behind the curtain."

**Simple code:** open the calculator **in a browser**, click `2`, `+`, `3`, `=`, and check the screen shows `5`.

**QAMart example:**
> *Scenario:* A customer can search for a phone → add to cart → apply coupon → pay → see the **confirmation page**
> with the order number.

Only a browser proves the **buttons, pages and screens connect** for a human.
Covered in: [tests/ui/01-customer-journey.spec.ts](../../tests/ui/01-customer-journey.spec.ts)

The UI test does **not** re-check all 30 coupon rules. It checks *"a coupon can be applied and the discount shows
on screen"*, **once**. The math is already proven by the unit tests.

**System API vs E2E UI:** API tests check the backend **answers correctly**. UI tests check the
**user can actually do it** on screen.

---

## 9. Non-functional testing: "not *what* it does, but *how well*"

**Everyday example:** The house works. But: does it stay standing in an **earthquake** (load)? Do the lights come on
**instantly** (speed)? Can a **stranger open the back door** (security)?

**Simple code:** the calculator gives `5`. ✅ But does it still answer in under 100 ms when **10,000 users**
press `=` at the same time?

**QAMart example:**
> *Scenario (REQ-NFR-05):* During the **Diwali sale**, browsing p95 stays **< 500 ms**, checkout p95 **< 2 s**,
> error rate **< 1 %**, and **no overselling**.

Covered in: [tests/load/diwali-sale.js:54](../../tests/load/diwali-sale.js:54) (k6)

```js
thresholds: {
  'http_req_duration{scenario:browsers}': ['p(95)<500'],
  'checkout_duration': ['p(95)<2000'],
  http_req_failed: ['rate<0.01'],
}
```

Other non-functional types: **security** (a customer can't reach `/internal/*` → `403 INTERNAL_ONLY`, REQ-NFR-06),
**resilience** (inventory down → product page still renders, [tests/ui/03-partial-failure.spec.ts](../../tests/ui/03-partial-failure.spec.ts)),
accessibility, observability.

**Functional vs non-functional:** layers 1-5 ask *"is the answer right?"*. Non-functional asks *"is it fast, safe and
stable enough?"*. It is a **dimension**, and can run at several levels (a unit benchmark, an API load test, a UI accessibility scan).

---

## 10. Summary

| # | Layer | Everyday example | Calculator | QAMart scenario | Where in code | Needs to run |
|---|---|---|---|---|---|---|
| 1 | **Unit** | Check one brick | `add(2,3) = 5` | WELCOME10 on ₹69,900 → ₹1,000 | `coupons.ts:26` discount formula | Nothing |
| 2 | **Component integration** | Check one room | Result saved in real DB | Max 10 per product across adds | `cart/index.ts:68-70` | Cart + its Postgres |
| 3 | **Contract** | Plug matches socket | App wants `result`, API sends `answer` | Order ↔ Payment response has `status`, `paymentId` | `checkout.ts:173` ↔ `payment/index.ts:53` | Contract file only |
| 4 | **System API** | Whole house from the front door | `POST /api/calc/add` over HTTP | Declined payment → stock + coupon given back | `tests/api/04-checkout.spec.ts:61` | Whole stack |
| 5 | **E2E UI** | Real guest makes tea | Click 2 + 3 = in a browser | Search → cart → pay → confirmation | `tests/ui/01-customer-journey.spec.ts` | Stack + browser |
| 6 | **Non-functional** | Earthquake / locks / speed | 10,000 users press `=` | Diwali sale p95 < 500 ms, < 1 % errors | `tests/load/diwali-sale.js` | Stack + load tool |

### Telling neighbouring layers apart

* **Unit vs component integration:** *Does it need the real database to go wrong?* No → unit. Yes → component.
* **Component vs contract:** *Is the bug inside one service, or in the message between two?* Inside → component. Between → contract.
* **Contract vs system API:** *Is it the shape of the message, or the outcome of the whole flow?* Shape → contract. Flow → system API.
* **System API vs E2E UI:** *Could a user still fail even if the API is right?* (button hidden, wrong page) → UI. Otherwise → API.
* **Functional vs non-functional:** *"Is the answer right?"* → layers 1-5. *"Is it fast / safe / stable?"* → non-functional.

> **Shift-left in one line:** push every scenario down to the **lowest layer that can prove it**.
