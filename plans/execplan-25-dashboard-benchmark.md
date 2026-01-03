# Dashboard Benchmark Admin Page

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

The dashboard needs an admin-only Benchmark page to observe and test CAN performance from the web UI. After this change, admins can open a Benchmark tab, watch incoming CAN frames with delay analysis, send ordered or fuzz frames with a configurable delay, and see error banners when ordering is violated or latency exceeds thresholds. This helps validate remote dongle performance directly from the dashboard without using the local PCAN tool.

## Progress

- [x] (2026-01-03 12:40Z) Add backend endpoints and data-plane routes for admin-only benchmarking (send and stream).
- [x] (2026-01-03 12:52Z) Implement the admin Benchmark page UI with ordered/fuzz send controls and live frame table.
- [x] (2026-01-03 13:05Z) Add delay/ordering detectors, thresholds, and dashboard alerts.
- [x] (2026-01-03 13:46Z) Add E2E tests and run them; update root scripts if needed (completed: added benchmark E2E coverage; ran full E2E suite).

## Surprises & Discoveries

- Observation: Initial E2E bootstrap required Docker Desktop to be running.
  Evidence: `unable to get image 'infra-api': ... open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.`

## Decision Log

- Decision: Expose the Benchmark page only to admins using existing role checks in the dashboard web app and API.
  Rationale: Benchmark tools can spam CAN traffic and should be restricted to trusted operators.
  Date/Author: 2026-01-03 / Codex

- Decision: Implement ordering checks in the dashboard UI by comparing each frame payload to the prior frame for the same CAN ID.
  Rationale: The ordered sender increments bytes deterministically; detecting a mismatch in sequence surfaces transport issues without backend changes.
  Date/Author: 2026-01-03 / Codex

- Decision: The benchmark send endpoint emits a single ordered or fuzz frame per request, while the UI schedules repeated sends at the chosen delay.
  Rationale: Keeps server logic stateless between requests while still supporting adjustable send cadence from the dashboard.
  Date/Author: 2026-01-03 / Codex

- Decision: Add a dedicated admin-only benchmark SSE route that reuses the existing stream manager with the dongle stream key.
  Rationale: Preserves the existing data-plane while ensuring benchmark streams are gated by admin role checks.
  Date/Author: 2026-01-03 / Codex

## Outcomes & Retrospective

Backend benchmark routes, the admin Benchmark page, and ordering/delay detectors are implemented. Web/API builds and the full E2E suite pass after bringing up the Docker test stack.

Plan update note: Marked E2E execution as complete after Docker stack passed and updated outcomes accordingly.

## Context and Orientation

The dashboard web UI lives in `apps/dashboard-web`, uses React + MUI, and consumes the API client in `apps/dashboard-web/src/api/client.ts`. The API server is `apps/dashboard-api`, with Express routes in `apps/dashboard-api/src/routes`. The CAN data-plane already exists for live console streaming; this plan adds benchmark endpoints and an admin-only UI tab/page.

Admin-only gating should reuse the existing auth/role state used in other admin-only pages or tabs (e.g., if the web app already hides admin-only features based on `user.role === "super_admin"`).

## Plan of Work

Add a new admin-only Benchmark page in `apps/dashboard-web` and a matching API surface in `apps/dashboard-api`:

Backend:

- Add benchmark endpoints under `/api/v1/benchmark` (or under `/api/v1/dongles/:id/benchmark`) in `apps/dashboard-api/src/routes`. Only allow access for `super_admin`.
- Implement a send endpoint that accepts `{ mode: "ordered" | "fuzz", delay_ms: number, can_id?: string, dlc?: number, extended?: boolean }` and forwards the request to the agent control plane (or data-plane) to send frames. Reuse the existing CAN send logic and agent control helpers to avoid duplicating code.
- Provide a stream endpoint or reuse the existing SSE stream to receive CAN frames for display. Ensure the response payload includes CAN id, dlc, payload, and a high-resolution timestamp so delay calculations are consistent.

Frontend:

- Add a new Benchmark page (e.g., `apps/dashboard-web/src/pages/BenchmarkPage.tsx`) and route it into the navigation (admin-only).
- Add controls to choose mode (Ordered or Fuzz), delay (ms), DLC, CAN ID (for ordered mode), and a start/stop action.
- Display a table of received frames with columns: timestamp, delta (ms), CAN id, DLC, payload.
- Implement ordering detection: for each CAN ID, track the last payload for ordered mode and verify the next payload increments correctly. If not, raise an error banner and log it in a visible error list.
- Implement delay thresholds: allow an “expected delay” field; compute frame-to-frame delta; classify: <=25ms OK, >25ms warn (orange), >50ms error (red). Display aggregate status and per-frame badges.
- Add a visible alert region for ordering errors and delay violations.

Testing:

- Add E2E tests under `apps/dashboard-e2e/tests` that log in as an admin user, open the Benchmark page, verify it is not visible to non-admin users, and exercise the UI interactions using mocked or seeded data.
- Add or update root scripts to run these E2E tests if needed.

## Concrete Steps

All commands run from `E:\Projets\STM32\workspace\dashboard`.

1) Add backend routes and services for benchmark send/stream with admin-only guards.
2) Add the Benchmark page UI and admin gating.
3) Implement client-side ordering and delay detectors.
4) Add E2E coverage and run:

  npm run e2e:up
  npm run e2e:prepare
  npm run e2e:test
  npm run e2e:down

## Validation and Acceptance

Acceptance is met when:

- Admin users see a Benchmark tab/page and can start ordered or fuzz sending with a delay value.
- The page displays incoming CAN frames with timestamp and delta, and errors appear when ordering or delay thresholds are violated.
- Non-admin users do not see the Benchmark page.
- E2E tests pass and confirm admin-only access plus basic UI interactions.

## Idempotence and Recovery

The UI and API changes are additive and safe to re-run. If benchmark traffic is too noisy, the feature can be disabled by hiding the route or removing access from the admin nav. Any new database fields should be additive and reversible via migrations.

## Artifacts and Notes

Expected E2E output example:

  > npm run e2e:test
  1 passed (benchmark admin access)

## Interfaces and Dependencies

Backend:

- Add `BenchmarkSendRequest` and `BenchmarkFrame` types in `apps/dashboard-api/src/services` or a shared module if needed.
- Add an admin guard using existing auth middleware for `super_admin`.

Frontend:

- `apps/dashboard-web/src/pages/BenchmarkPage.tsx` for UI.
- `apps/dashboard-web/src/api/client.ts` for benchmark send/stream.
- Add routing entry in the dashboard router, gated by admin role.

Plan change note: Initial ExecPlan created on 2026-01-03 to add an admin-only Benchmark page with ordered/fuzz send controls, delay/ordering detection, and E2E coverage.
