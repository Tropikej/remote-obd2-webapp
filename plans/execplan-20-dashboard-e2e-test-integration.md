# Dashboard E2E Test Integration

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

This plan supersedes and incorporates the defaults from `plans/dashboard-e2e-test-plan-v0.1.md`. The earlier document remains a reference draft, but this ExecPlan is the authoritative, self-contained guide for implementation.

## Purpose / Big Picture

After this work, the repository will have an end-to-end test suite that starts the dashboard stack, drives real browser flows with Playwright, and produces reproducible artifacts when failures occur. A developer or CI runner will be able to spin up the stack, run a smoke suite, and see verified outcomes for authentication, protected routes, and at least one CRUD flow, plus edge-case coverage for critical paths. The plan explicitly connects every test to a user-visible behavior so a novice can confirm the system works.

## Progress

- [x] (2025-12-29 21:10Z) Resolve open decisions that determine the E2E environment (auth strategy, frontend mode, Nginx scope, Prisma seed runner, CI platform, DB reset strategy).
- [x] (2026-01-02 10:08Z) Scaffold the E2E workspace with Playwright config, test helpers, and environment plumbing.
- [x] (2026-01-02 10:08Z) Define and implement the E2E runtime stack (Docker Compose + service startup) with deterministic DB/Redis state.
- [x] (2026-01-02 10:08Z) Add the smoke suite scenarios and at least one regression suite scenario.
- [x] (2026-01-02 10:08Z) Add edge-case E2E scenarios that exercise the most failure-prone user paths.
- [x] (2026-01-02 10:08Z) Integrate local and CI scripts, artifacts, and documentation.
- [x] (2026-01-02 12:20Z) Validate the suite by running it end-to-end and capturing artifacts.

## Surprises & Discoveries

There is no existing Prisma seed file or seed command in this repository, and the only Docker Compose file (`infra/docker-compose.dev.yml`) currently manages Postgres and Redis only. There are no Dockerfiles for the API or web services, so containerizing those services will require new Docker build definitions.

- Observation: The admin UI references list/disable/audit endpoints that do not exist in the API router, so the regression test focuses on role-gating rather than the admin data tables.
  Evidence: `apps/dashboard-api/src/routes/admin.ts` only exposes `/ping` and `/dongles/:id/force-unpair`.

## Decision Log

- Decision: Use UI login once and reuse Playwright storageState for the bulk of E2E tests, with a dedicated login-flow test preserved.
  Rationale: Preserves realism while keeping the suite faster and less flaky than logging in for every test.
  Date/Author: 2025-12-29 / Codex
- Decision: Run E2E against built assets and a compiled API behind Nginx.
  Rationale: Maximizes production parity and reduces differences between CI and production behavior.
  Date/Author: 2025-12-29 / Codex
- Decision: Include Nginx in the E2E stack and target the root path (no `/dashboard` base path).
  Rationale: Nginx is production critical and the repo does not define a base path, so root routing is the correct parity target.
  Date/Author: 2025-12-29 / Codex
- Decision: Containerize API and web for E2E using new Dockerfiles and run them inside `infra/docker-compose.e2e.yml`.
  Rationale: Avoids host-networking pitfalls in GitHub Actions and keeps the E2E stack self-contained.
  Date/Author: 2025-12-29 / Codex
- Decision: Implement Prisma seeding as `prisma/seed.js` and run it with Node.
  Rationale: Keeps the E2E seed path close to production by avoiding ts-node or tsx runtime requirements.
  Date/Author: 2025-12-29 / Codex
- Decision: Integrate E2E runs into the repository's GitHub Actions workflow.
  Rationale: The primary CI pipeline is GitHub Actions and should enforce E2E coverage for rugged CI.
  Date/Author: 2025-12-29 / Codex
- Decision: Expand the E2E suite to cover edge cases for the most critical user flows (auth failures, validation errors, session expiry, and authorization boundaries).
  Rationale: The E2E suite should catch regressions beyond happy paths and verify the system behaves safely under common failure modes.
  Date/Author: 2025-12-29 / Codex
- Decision: Use deterministic UUIDs and device IDs for seeded E2E fixtures so Playwright tests can navigate directly without runtime discovery.
  Rationale: Stable identifiers reduce flakiness and keep test steps simple and repeatable across runs.
  Date/Author: 2026-01-02 / Codex
- Decision: Simulate a 500 response via Playwright route interception for UI error rendering coverage.
  Rationale: The current API paths do not expose a deterministic 500 case without breaking the stack, so interception keeps the error UI test stable.
  Date/Author: 2026-01-02 / Codex
- Decision: Bind the E2E Nginx service to host port 8080 to avoid conflicts with local services.
  Rationale: 8080 is a common, conflict-free port for local testing and CI runners.
  Date/Author: 2026-01-02 / Codex

## Outcomes & Retrospective

E2E suite executed successfully via `npm run e2e:up`, `npm run e2e:prepare`, and `npm run e2e:test`. All Playwright tests passed.

## Context and Orientation

This repository is a monorepo using npm workspaces with three application packages: `apps/dashboard-web` (Vite + React web app), `apps/dashboard-api` (Express + Prisma API), and `apps/bridge-agent` (desktop agent). There is no dedicated E2E application package today. The API uses `express-session` with a Postgres-backed session store (`connect-pg-simple`), so authentication likely uses cookies rather than JWTs, but the exact login flow still needs to be confirmed. There is a production Nginx configuration at `infra/nginx/obd2-dashboard.conf` that proxies API routes, WebSocket endpoints, and serves the built web app. The only existing Compose file is `infra/docker-compose.dev.yml`, which runs Postgres and Redis. There is no Prisma seed script and no E2E-specific Compose file yet.

This ExecPlan introduces a new E2E package (an npm workspace) and a new Compose stack. It also adds scripts at the repository root so that running E2E tests is consistent across developers and CI. The plan assumes Playwright is the test runner, which is already a dev dependency in the repo, and uses the existing npm workspace conventions.

The environment decisions are now resolved: E2E will run through Nginx, use built web assets and a compiled API inside containers, use UI login once with a stored Playwright session, and run in GitHub Actions. Prisma seeding will be implemented as a Node script (`prisma/seed.js`) to avoid TS runtime dependencies. This plan will build new Dockerfiles for API and web, and a dedicated `infra/docker-compose.e2e.yml` that runs Postgres, Redis, API, web, and Nginx.

## Plan of Work

Implement E2E with a fully containerized stack that includes Postgres, Redis, API, web, and Nginx. Use built assets (`vite build`) and a compiled API (`tsc` output) in their containers. Route all test traffic through Nginx at the root path. Use Playwright UI login once with `storageState` and keep a dedicated login test to validate the flow.

Create a new E2E workspace at `apps/dashboard-e2e` so tests and helpers live in a dedicated package. Add a `package.json` with `@playwright/test` and `typescript`, and add Playwright configuration in `apps/dashboard-e2e/playwright.config.ts`. Configure the base URL from `E2E_BASE_URL`, set up artifact capture (HTML report, trace on retry, screenshot/video on failure), and provide a global setup that logs in once and writes a `storageState.json` if the chosen auth strategy is UI-based. Add helper utilities in `apps/dashboard-e2e/helpers` for API seeding, consistent selectors, and polling for readiness.

Define the runtime stack in a new `infra/docker-compose.e2e.yml`. Create `infra/nginx/obd2-dashboard.e2e.conf` that proxies to the API container, serves the built web app from a volume mount, and supports WebSockets and SSE. Add Dockerfiles for `apps/dashboard-api` and `apps/dashboard-web`. The API Dockerfile will build `@dashboard/shared` then compile the API with `npm run build --workspace apps/dashboard-api`; the web Dockerfile will build the web app with `npm run build --workspace apps/dashboard-web`. Implement a Prisma seed script at `prisma/seed.js` and wire it into the root `package.json` via a `prisma.seed` entry so `npx prisma db seed` works in the API container. Define the seed data required to render the dashboard without errors and to exercise one CRUD flow.

Add a small but representative smoke suite in `apps/dashboard-e2e/tests` that proves the app boots, login works, protected routes redirect unauthenticated users, a basic list view is populated from the API, a simple create flow succeeds, and logout clears the session. Then add a regression scenario for authorization boundaries (standard user blocked from an admin page) to enforce role isolation. Expand the suite with explicit edge-case scenarios for the most failure-prone paths: invalid login credentials, locked or disabled accounts, form validation errors on create/update flows, duplicate or conflict responses on create, expired sessions forcing a login redirect, and API 500/503 responses that must render error UI without crashing the page. Use data-testid selectors and Playwright auto-wait to reduce flakiness. Ensure every test documents the user-visible behavior it proves.

Add root-level npm scripts that orchestrate E2E runs, such as `e2e:up`, `e2e:prepare`, `e2e:test`, and `e2e:down`, and ensure they point to the new Compose file and E2E workspace commands. Update `.github/workflows/ci.yml` to run the E2E workflow in GitHub Actions, including: bringing up the E2E stack, running migrations + seed inside the API container, executing Playwright tests, and uploading Playwright artifacts and container logs on failure.

Finally, run the full E2E flow locally to confirm the stack boots, tests run, and artifacts are produced, and capture minimal logs in the plan to prove that the system works.

## Concrete Steps

All commands run from `E:\Projets\STM32\workspace\dashboard` unless stated otherwise. The final commands will be:

    npm run e2e:up
    npm run e2e:prepare
    npm run e2e:test
    npm run e2e:down

The Compose file will include Postgres, Redis, API, web, and Nginx. The base URL will be the Nginx host, and Playwright will target that URL via `E2E_BASE_URL`.

## Validation and Acceptance

Acceptance is met when a developer can start the E2E stack, run the Playwright suite, and observe a passing run with artifacts generated on failure. Specifically, the app must load through the chosen base URL, a real login flow must establish a session, protected routes must redirect when unauthenticated, a basic list view must populate via API data, and one CRUD happy path must succeed. A regression test must confirm that a standard user cannot access an admin-only page. Edge-case tests must also pass and are explicitly required for invalid login credentials, locked or disabled accounts, form validation failures, duplicate/conflict create responses, session expiry handling, and API 500/503 error surfacing in the UI. The plan will include exact commands, expected URLs, and example output once the environment decisions are finalized.

## Idempotence and Recovery

The E2E stack must be safe to bring up and tear down repeatedly. The database reset strategy should be repeatable; if migrations or seed data fail, the plan must specify how to reset by re-running migrations or recreating the test volume. Any destructive steps (such as `docker compose down -v`) will be clearly marked, and safe alternatives (such as a dedicated E2E volume) will be included.

## Artifacts and Notes

The E2E run must produce Playwright HTML reports, traces on retry, and screenshots or videos on failure. The plan will also capture short excerpts of server logs that demonstrate successful startup and a single test pass. Validation run completed; no failure artifacts were generated.

## Interfaces and Dependencies

Create an npm workspace at `apps/dashboard-e2e` with Playwright configuration in `apps/dashboard-e2e/playwright.config.ts`, tests in `apps/dashboard-e2e/tests`, and helpers in `apps/dashboard-e2e/helpers`. Add root scripts in `package.json` for E2E orchestration. Add `infra/docker-compose.e2e.yml` and, if Nginx is included, `infra/nginx/obd2-dashboard.e2e.conf`. Add a Prisma seed implementation under `prisma/seed.ts` and configure the seed runner in the root `package.json` or in `apps/dashboard-api/package.json` so `prisma db seed` succeeds.

The Prisma seed implementation lives at `prisma/seed.js` and is wired via the root `package.json` `prisma.seed` entry. Dockerfiles are defined at `apps/dashboard-api/Dockerfile` and `apps/dashboard-web/Dockerfile` for the containerized E2E stack.

Plan change note: Recorded implementation progress, added findings about missing admin endpoints, and captured new decisions on fixtures, error simulation, and port selection (2026-01-02).

Plan change note: Updated the plan with finalized decisions (UI login storageState, built assets behind Nginx, containerized API/web, Node seed script, GitHub Actions CI) on 2025-12-29 and renumbered the plan to ExecPlan 20 to avoid collision.
Plan change note: Expanded the suite to include edge-case E2E scenarios for critical flows on 2025-12-29 to meet the request for maximum edge-case coverage.
Plan change note: Marked validation status as UNTESTED per request (2026-01-02).
Plan change note: Recorded successful E2E run after fixing Docker and rate-limit issues (2026-01-02).
