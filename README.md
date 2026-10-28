# QAMart: E-Commerce System Design Learning Lab for QA Engineers

A locally runnable, Amazon-style shop built as a **real multi-service system** for the module
*System Design Fundamentals for Test Engineers* (course: **Modern QA Engineering: System Design, DevOps & AI**).

Students follow one customer journey (search for an iPhone → view stock → add to cart → apply a coupon → pay → get a confirmation → see order history). Every system-design concept is shown on that journey **in the running system**: a gateway and load balancer, microservices, Redis caching, SQL and NoSQL databases, RabbitMQ messaging, idempotency, failures and recovery.

| What | URL |
|---|---|
| 🛒 Customer shop | http://localhost:8080 |
| 🎓 System Design Teaching Dashboard | http://localhost:8081 |
| 📘 API documentation (Swagger UI) | http://localhost:8080/api-docs/ |
| 🐇 RabbitMQ console | http://localhost:15672 (`qamart` / `qamart_pw`) |
| 🗄️ Adminer (SQL browser) | http://localhost:8082 (server `postgres`, user `lab_readonly`, password `lab_readonly_pw`, database e.g. `order_db`) |

All ports bind to `127.0.0.1` only.

---

## Prerequisites

* **Docker Desktop** (or Docker Engine + Compose v2.24+) with about **4 GB RAM** for Docker
* Free ports: 8080, 8081, 8082, 15672, 55432, 57017, 56379 (override them in `.env`, see `.env.example`)
* For the sample tests (optional): **Node.js 20+** and **k6** (https://k6.io/docs/get-started/installation/)

No cloud accounts, no paid services. All payments are **simulated**: no card data is ever collected.

## Start / stop

```bash
docker compose up --build -d      # first build takes a few minutes
docker compose ps                 # wait until services show "(healthy)"
```

Open http://localhost:8080 and log in with a demo account:

| Account | Password | Role |
|---|---|---|
| `alice@qamart.test`, `bob@qamart.test`, `carol@qamart.test` | `Password@123` | customer |
| `admin@qamart.test` | `Password@123` | admin (can change prices via API) |
| `loadtest01…50@qamart.test` | `Password@123` | customers for automated / load tests |

```bash
docker compose stop               # pause everything (keeps data)
docker compose start              # resume
docker compose down               # remove containers (keeps data volumes)
docker compose down -v            # remove containers AND data (full clean slate)
```

### Reset to a known state (before every lecture / demo)

```bash
./scripts/reset.sh                # or: Dashboard → Failure lab → "Reset lab to known state"
```

Reset restarts stopped containers, clears all injected faults, purges queues, re-seeds every service's data (users, products, stock, coupons; orders/carts/payments emptied), flushes Redis and clears traces.

### Production-like mode (teaching features OFF)

```bash
docker compose down
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

In this mode `LAB_MODE=false`: there's no dashboard (:8081), no `/__lab` endpoints, no diagnostic headers (`X-Served-By`, `X-Cache`) and no trace export. Switch back with `docker compose down && docker compose up -d`.

## What's running

```
nginx (:8080 edge gateway + LB, :8090 internal LB, :8081 dashboard)
├── auth          → PostgreSQL auth_db
├── product-1/2/3 → MongoDB catalog_db + Redis      (3 instances, round robin)
├── cart          → PostgreSQL cart_db
├── inventory     → PostgreSQL inventory_db
├── order         → PostgreSQL order_db (+ outbox) → RabbitMQ
├── payment       → PostgreSQL payment_db           (simulated)
├── notification  ← RabbitMQ → MongoDB notification_db
└── lab           (teaching control plane: traces, health, faults, demos)
```

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for diagrams, data ownership and request flows.

## Documentation

| File | For |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System diagram, responsibilities, data ownership, sync vs async flows |
| [INSTRUCTOR_GUIDE.md](INSTRUCTOR_GUIDE.md) | Step-by-step lecture demos 1-7 + Diwali sale, expected behaviour, discussion questions |
| [STUDENT_ASSIGNMENTS.md](STUDENT_ASSIGNMENTS.md) | Exercises by component, Diwali capstone, evaluation criteria, scaling guidance |
| [API_REFERENCE.md](API_REFERENCE.md) | Endpoints, examples, error codes, authentication (plus the live Swagger UI) |
| [docs/openapi.yaml](docs/openapi.yaml) | Machine-readable contract (used by the contract tests) |

## Sample automated tests

```bash
cd tests
npm install
npx playwright install chromium
npm test              # all tests (~3 min), resets the lab first
npm run test:api      # API, contract, concurrency, idempotency, messaging, cache, LB tests
npm run test:ui       # Playwright browser tests (customer journey, validation, partial failure)
npm run test:fast     # skips tests tagged @slow (the ones that stop containers / wait for retries)
npm run report        # open the HTML report
npm run load:smoke    # 20-second k6 sanity run
npm run load          # ~2-minute local Diwali-sale load test (needs k6)
```

| Folder | Contents |
|---|---|
| `tests/api` | 53 API tests: products, auth/authorization, cart, checkout, idempotency, inventory concurrency, messaging (retry/DLQ/duplicates/outbox), cache (hit/miss/TTL/stale/Redis down), load balancer |
| `tests/ui` | 9 Playwright UI tests |
| `tests/support` | helpers: lab API (faults, scenarios), contract validator (`expectSchema`), `eventually()` for eventual consistency |
| `tests/load` | k6 `diwali-sale.js` |

Tests run **one at a time** against the shared lab (`workers: 1`) and reset it before each run.

## Useful commands

```bash
docker compose logs -f order                      # follow one service
./scripts/shell.sh logs <request-id>              # every log line for one request, across services
./scripts/shell.sh psql order_db                  # SQL shell (read-only user)
./scripts/shell.sh mongo catalog_db               # MongoDB shell (read-only user)
./scripts/shell.sh redis                          # redis-cli  (try: KEYS product:*  /  TTL product:iphone-15-128)
./scripts/sale.sh on                              # Diwali sale mode on/off
docker compose stop product-2                     # real failure: one instance down
docker compose start product-2
```

External SQL/Mongo clients (DBeaver, Compass…): Postgres `localhost:55432`, Mongo `mongodb://lab_readonly:lab_readonly_pw@localhost:57017/?authSource=admin`, Redis `localhost:56379`.

## Local development without rebuilding images

```bash
cd frontend && npm install
npm run dev:shop     # http://localhost:5173, proxies /api to the Docker stack
npm run dev:lab      # http://localhost:5174, proxies /lab/api to the Docker stack
```
Backend: edit `backend/services/<name>/src`, then `docker compose up --build -d <name>` (product: `product-1 product-2 product-3`).

## Project structure

```
backend/
  packages/common/      shared library: tracing, logging, faults, auth, HTTP client, Postgres, RabbitMQ
  services/<name>/      auth, product, cart, inventory, order, payment, notification, lab
  Dockerfile            one image for all Node services
frontend/
  shop/                 React + TypeScript customer shop
  lab-dashboard/        React + TypeScript teaching dashboard
infra/                  nginx (gateway/LB config + image), postgres & mongo init, rabbitmq config
docs/openapi.yaml       API contract
tests/                  Playwright API/UI tests, contract validation, k6 load test
scripts/                reset, sale mode, data-store shells
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `port is already allocated` | Another app uses the port. Set a different one in `.env` (see `.env.example`). |
| Services restart in a loop right after first start | Databases are still initialising. Wait 30-60 s; `docker compose ps` shows health. |
| Dashboard shows everything DOWN | Is the lab container running? `docker compose logs lab`. Hard-refresh the page. |
| Dashboard "Container controls unavailable" | The Docker socket isn't mounted (some Docker setups, e.g. rootless or Podman). Use `docker compose stop/start <service>` in a terminal instead; everything else works. |
| A service shows UP but the shop says unavailable for a few seconds after a restart | Expected: Nginx re-discovers containers through DNS every 5 s. A good teaching point ("healthy ≠ reachable"). |
| Demo behaves oddly | A fault is probably still active. Run `./scripts/reset.sh`. |
| Tests fail with "QAMart is not reachable" | Start the stack first; tests expect http://localhost:8080 and :8081. |
| Want a totally fresh database | `docker compose down -v && docker compose up --build -d` |
| Apple Silicon / ARM | All images are multi-arch; no changes needed. |
| Windows | Use Docker Desktop + WSL2 or Git Bash for `scripts/*.sh` (or run the `curl` commands from the docs). |

## Safety notes

* Teaching controls are local-only: bound to 127.0.0.1, token-protected, and disabled in production mode.
* The lab service mounts the Docker socket to stop/start containers for failure demos. Don't run the lab on a shared or production host.
* All secrets in this repository are **local demo values**. Payments, e-mails and products are fictional.
