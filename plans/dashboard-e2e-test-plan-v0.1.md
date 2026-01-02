# Dashboard E2E Test Plan (Default) — v0.1

**Project context (current):** Monorepo dashboard using **Vite + TypeScript** (web), **Express + Prisma** (API), **PostgreSQL (Docker)**, **Redis (Docker)**, **Nginx**, and containerized local/CI environments.

This plan defines a **default end-to-end testing approach** that can be implemented immediately, while leaving open decisions and clarifications explicitly tracked.

---

## 1. Objectives

### 1.1 Primary goals
- Validate **critical user journeys** through the system (browser → Nginx → web → API → DB/Redis).
- Catch regressions in:
  - authentication and authorization
  - core dashboard flows (read/write)
  - routing / proxy behavior
  - caching/session behavior (Redis)
- Produce actionable debugging artifacts on failure (trace, screenshots, logs).

### 1.2 Non-goals (for v0.1)
- Exhaustive UI visual regression (can be added later).
- Load/performance testing (separate track).
- Security testing beyond basic authz checks (separate track).

---

## 2. E2E Stack (Default)

### 2.1 Test runner
- **Playwright** (`@playwright/test`) for browser-driven E2E.

### 2.2 Test environment orchestration
- **Docker Compose** with a dedicated file: `docker-compose.e2e.yml`
- Services included:
  - `postgres` (fresh DB per run)
  - `redis` (fresh cache per run)
  - `api` (Express)
  - `web` (Vite build/preview or container)
  - `nginx` (optional but recommended if it exists in production)

### 2.3 Data management
- **Prisma migrations** applied to the E2E DB:
  - `prisma migrate deploy`
- **Prisma seed** populates deterministic fixtures:
  - `prisma db seed`

---

## 3. Repository Structure (Default)

Recommended monorepo layout (adapt as needed):

```
/apps
  /web        # Vite + TS
  /api        # Express + Prisma
  /e2e        # Playwright tests (new)
/infra
  docker-compose.e2e.yml
  nginx.e2e.conf          # if Nginx is included in E2E
```

E2E package:

```
/apps/e2e
  playwright.config.ts
  tests/
  fixtures/
  helpers/
  README.md
```

---

## 4. Test Execution Lifecycle (Default)

### 4.1 Local developer workflow
1. **Bring up E2E stack**
   - `docker compose -f infra/docker-compose.e2e.yml up -d --build`
2. **Apply schema + seed**
   - `docker compose -f infra/docker-compose.e2e.yml exec -T api npx prisma migrate deploy`
   - `docker compose -f infra/docker-compose.e2e.yml exec -T api npx prisma db seed`
3. **Run Playwright**
   - `pnpm --filter e2e playwright test`
4. **Tear down (optional)**
   - `docker compose -f infra/docker-compose.e2e.yml down -v`

### 4.2 CI workflow (baseline)
1. Start compose stack
2. Wait on health checks
3. Run migrations + seed
4. Run Playwright headless
5. Upload artifacts:
   - Playwright report
   - trace zip(s)
   - screenshots/videos (failures)
   - container logs (api/nginx)

---

## 5. DB & State Strategy (Default)

### 5.1 Reset cadence
**Default:** reset **once per test run** (suite-level isolation).
- DB starts empty (fresh volume or ephemeral container)
- Run migrations + seed once
- Test suite executes against deterministic baseline

### 5.2 Redis strategy
- Fresh Redis per run
- Tests should not depend on cache state unless explicitly testing caching.

### 5.3 Seeding policy
Seed creates:
- `admin` user
- `standard` user
- 1 workspace/org
- minimal reference data required for app boot and key flows

Fixtures must be:
- deterministic
- minimal
- additive (avoid over-seeding)

---

## 6. Authentication Approach (Default)

### 6.1 Default approach: UI login + storageState reuse
- One test (or a global setup) performs a real UI login
- Save Playwright `storageState` to reuse in most tests
- Keep at least one dedicated test that validates the actual login flow

**Notes**
- This gives high confidence but can be slower.
- If login becomes flaky (SSO, CAPTCHA, email codes), switch to a test-auth shortcut (see choices section).

---

## 7. Test Suite Design

### 7.1 Test levels inside E2E
- **Smoke**: minimal, fast, runs on every PR
- **Full regression**: runs on merge to main and nightly

### 7.2 Tagging convention
- `@smoke`
- `@regression`
- `@auth`
- `@admin`
- `@crud`
- `@routing`

Example:
- `dashboard.smoke.spec.ts`
- `users.admin.spec.ts`

### 7.3 Flake control rules
- Prefer deterministic selectors (data-testid)
- Avoid hard waits; rely on Playwright auto-wait
- Any test retry must generate trace artifacts
- Set a strict budget for retries (e.g., 1 retry in CI only)

---

## 8. Core Test Scenarios (Default Backlog)

> This is the initial test matrix. Adjust names to your actual routes/features.

### 8.1 Smoke (must-have)
1. **App boots**
   - web loads through base URL
   - no fatal console errors
2. **Login works**
   - standard user can login and reach dashboard
3. **Protected route**
   - unauthenticated user redirected to login
4. **Basic API-driven view**
   - dashboard loads data list/table from API
5. **Create flow (happy path)**
   - create a simple entity (e.g., “item”, “project”)
   - confirm it appears in list
6. **Logout**
   - session cleared and protected routes require login again

### 8.2 Regression (high value)
1. **Authorization boundaries**
   - standard user cannot access admin page
   - admin user can access admin page
2. **CRUD full cycle**
   - create, update, delete entity
3. **Form validation**
   - required fields / backend validation surfaced correctly
4. **Pagination & filters**
   - filters persist and match API results
5. **Error handling**
   - API 500 triggers error UI (toast/banner)
6. **Nginx routing**
   - base path rewrites, SPA fallback works, API proxy path works
7. **Redis/session behavior** (if applicable)
   - session invalidation, TTL behavior, cache busting

### 8.3 Nice-to-have (later)
- Visual snapshots for a few key pages
- Multi-tab session behavior
- Mobile viewport sanity checks
- Accessibility checks (axe)

---

## 9. Observability & Artifacts (Default)

### 9.1 Playwright artifacts
- HTML report enabled
- Trace on first retry
- Screenshot on failure
- Video on failure (CI)

### 9.2 Container logs
Capture on failure:
- `api` logs
- `nginx` logs
- `postgres` logs (optional)
- `redis` logs (optional)

### 9.3 Debug convenience
- Provide a single “repro” command line
- Keep `E2E_BASE_URL` and `E2E_API_URL` envs supported

---

## 10. Scripts (Default)

At repo root (example with pnpm):

- `e2e:up`  
  `docker compose -f infra/docker-compose.e2e.yml up -d --build`

- `e2e:prepare`  
  `docker compose -f infra/docker-compose.e2e.yml exec -T api npx prisma migrate deploy && docker compose -f infra/docker-compose.e2e.yml exec -T api npx prisma db seed`

- `e2e:test`  
  `pnpm --filter e2e playwright test`

- `e2e:down`  
  `docker compose -f infra/docker-compose.e2e.yml down -v`

---

## 11. Acceptance Criteria (v0.1)

The E2E plan is considered “implemented” when:
- Smoke suite runs locally and in CI reliably (< ~10 minutes on CI)
- Failures produce useful artifacts (report + trace + screenshots)
- DB is deterministic via migrations+seed
- At least:
  - 1 auth test
  - 1 protected-route test
  - 1 CRUD happy path
  - 1 admin/permission boundary test

---

# Part A — Clarifications Needed (to finalize the plan)

Provide answers later; keep this list as the “inputs” required to lock down the final E2E architecture.

1. **Auth model**
   - Cookies + server sessions? JWT in localStorage? Mixed?
   - SameSite/secure cookie behavior behind Nginx?

2. **Frontend deployment mode**
   - Do you want E2E to test `vite preview` (built assets) or `vite dev server`?
   - Any base path (e.g. `/dashboard`) behind Nginx?

3. **Nginx in scope**
   - Should E2E always run through Nginx (recommended if it’s production-critical)?
   - Are there multiple upstreams (api/web) and special headers?

4. **Prisma setup**
   - Current migration strategy: `migrate dev` in dev, `migrate deploy` in CI?
   - Seed runner: `ts-node`, `tsx`, compiled JS?

5. **Test data requirements**
   - Minimal set of entities required to render dashboard without errors
   - Any hard dependencies on external APIs/services?

6. **CI platform**
   - GitHub Actions? GitLab CI? Other?
   - Do you need sharding/parallel jobs?

---

# Part B — Choices To Make (must be decided before the plan can be finished)

These are actual forks in approach. Pick defaults now or later, but the plan cannot be “final” until they are locked.

## Choice 1 — Include Nginx in E2E?
- **Option A (recommended):** test via Nginx (closest to production; catches proxy/routing/cookie issues)
- Option B: bypass Nginx (faster; fewer moving parts; less realistic)

## Choice 2 — DB reset level
- **Option A (default):** reset once per run (compose down -v, migrate+seed)
- Option B: reset per test file (more isolation; slower)
- Option C: truncate tables between tests (fast but requires careful FK ordering)

## Choice 3 — Auth strategy in tests
- **Option A (default):** UI login once + reuse `storageState`
- Option B: E2E-only “test login” endpoint to mint session/JWT (faster/less flaky)
- Option C: Seed a static token/key (fast but less realistic; careful with security)

## Choice 4 — Frontend mode under test
- **Option A (default):** built assets (`vite build` + `vite preview`) for production parity
- Option B: dev server (`vite dev`) for faster iteration, less parity

## Choice 5 — Parallelization
- Option A: Playwright local parallel by workers (default)
- Option B: CI sharding across jobs (faster, more setup)

---

# Appendix — Default Environment Variables

- `E2E_BASE_URL` (e.g., `http://localhost:8080`)
- `E2E_API_URL`  (e.g., `http://localhost:8080/api`)
- `DATABASE_URL` (E2E DB)
- `REDIS_URL`    (E2E cache)
- `NODE_ENV=e2e` (optional flag for E2E behaviors)

