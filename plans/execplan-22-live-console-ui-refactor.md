# Live Console UI Refactor

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the Live Console page is easier to read on desktop, uses space efficiently, and separates CAN and command workflows into clear tabs. Filters become a left-side vertical bar, the CAN console exposes sending and live frame visibility with stats, the Command console presents CLI-style output, and a single Events card provides a unified, filterable stream across all event types. A user can open the console, switch between CAN and Command tabs, and immediately understand what traffic is live without scrolling through mixed content.

## Progress

- [x] (2025-12-29 22:10Z) Confirm required UI layout and compute strategy for CAN bus load.
- [x] (2025-02-14 13:55Z) Restructured the Live Console layout into a left filter bar, a main tabbed console area, and a dedicated Events card.
- [x] (2025-02-14 13:55Z) Implemented CAN tab: send form, live CAN frames, bus stats, and CAN ID filter.
- [x] (2025-02-14 13:55Z) Implemented Command tab: command send form and CLI-style output panel.
- [x] (2025-02-14 13:55Z) Made the Events card filterable across all event types and kept filters in the left sidebar.
- [x] (2025-02-14 14:05Z) Added/extended E2E tests for the Live Console UI and ran them successfully.
- [x] (2025-02-14 14:05Z) Validated desktop readability and responsive behavior via the new three-column layout and mobile stacking.

## Surprises & Discoveries

- Observation: The current Live Console page interleaves Events, Command, and CAN UI in a single grid, which reduces readability on wide screens.
  Evidence: `apps/dashboard-web/src/pages/ConsolePage.tsx` renders Events on the left and Command/CAN cards on the right without a persistent filter sidebar or tab separation.
- Observation: There is no existing CAN bus load source; only live frame events are available in the console stream.
  Evidence: `apps/dashboard-web/src/pages/ConsolePage.tsx` computes a simple CAN rate from SSE events and the API client has no bus load endpoint.
- Observation: E2E group creation fails if the seed step is skipped because dongles can remain attached to an existing group.
  Evidence: The UI shows "Dongle is already part of a group." in `apps/dashboard-e2e/test-results` unless `npm run e2e:prepare` is run.

## Decision Log

- Decision: Compute CAN bus load only when the bitrate is known; if unknown, surface "missing parameters (bitrate unknown)" to the user.
  Rationale: A bus load estimate is meaningless without bitrate; the UI should be honest about missing inputs.
  Date/Author: 2025-12-29 / Codex
- Decision: Use `api.getDongle` and `can_config.bitrate` as the bitrate source for bus load; otherwise report bitrate unknown.
  Rationale: The console stream does not include bitrate data, and only dongle detail exposes the configured bitrate.
  Date/Author: 2025-02-14 / Codex
- Decision: Place the Events card on the right column in desktop layout so it remains visible while using the console tabs.
  Rationale: Always-visible events improve monitoring and reduce context switching.
  Date/Author: 2025-12-29 / Codex

## Outcomes & Retrospective

- Implemented a three-column Live Console layout with a left Target/Filters bar, tabbed CAN/Command center, and a right Events stream.
- Added CAN send controls, live frames table, CAN ID filtering, and 5s stats with bus-load estimates when bitrate is known.
- Added a CLI-style Command log panel and kept the unified Events stream filterable by type, direction, and search.
- Added Playwright coverage for console layout/filters and ensured existing E2E tests pass.
- Tests: `npm run e2e:up`, `npm run e2e:prepare`, `npm run e2e:test`, `npm run e2e:down`.

## Context and Orientation

The Live Console page is implemented in `apps/dashboard-web/src/pages/ConsolePage.tsx` and uses MUI components plus `InfoCard` from `packages/ui`. It streams events via the `useSse` hook in `apps/dashboard-web/src/hooks/useSse.ts` and currently mixes command, CAN, and event UI in a two-column layout. Filters are a horizontal card near the top of the page. The page uses `api.sendCommand` and `api.sendCanFrame` from `apps/dashboard-web/src/api/client.ts`. The Events card renders a mix of `can_frame`, `command_status`, `presence`, `log`, and other SSE event types, but filtering is limited to RX/TX, logs, presence, and a search string.

This plan refactors the UI only; it does not change backend behavior. It introduces tabbed consoles (CAN vs Command), a left sidebar for filters and target selection, a dedicated Events card that remains visible, and additional filtering and stats for CAN traffic.

## Plan of Work

Refactor the Live Console layout to use a three-column desktop grid: a left sidebar for Target + Filters, a main content column with tabs for CAN and Command consoles, and a right column for the unified Events card. On smaller screens, collapse to a single column where the sidebar content appears above the tabs and the Events card appears after the tabs. Use MUI `Tabs`/`Tab` with explicit `TabPanel` components for clarity and to separate CAN/Command flows.

Implement the left sidebar as a vertical stack of `InfoCard`s. Place the Target selector and connection stats at the top, followed by a Filters card that contains event-type toggles (CAN, Command, Logs, Presence, Group State, Stream Reset), RX/TX toggles for CAN, and a global search field. These filters should apply to the Events card and allow the user to include/exclude event types explicitly.

In the CAN tab, keep the send form but visually separate it from the live frames and stats. Add a CAN ID filter input that filters the live CAN frame list and optionally highlights matching frames in the Events card. Add CAN stats computed from the live stream: total frames in the last N seconds, RX vs TX counts, and a “bus load” indicator. Bus load must be computed only when the bitrate is known (from the dongle config or a selected default); otherwise show a clear message that parameters are missing. Document the exact bitrate source and fallback in the Decision Log.

In the Command tab, keep the command send form but move it into the tab and render the response log in a CLI-like panel. The CLI panel should be monospaced, have a contrasting background, and show timestamps plus status and stdout/stderr. Use a fixed-height scrollable container so the command log does not push the page down. Each entry should show command id, status, and truncated markers when present.

Keep the Events card on the page as a unified stream of all event types, placed in the right column on desktop. It should respect the global filters and include clear labels for event types. When events are filtered out, show a hint that filters are active. Ensure the Events card remains discoverable and does not collapse under the tabs on desktop.

Add E2E tests for the Live Console UI in the repository’s E2E suite. If the E2E suite from `plans/execplan-20-dashboard-e2e-test-integration.md` already exists, extend it with tests that: open the console, switch between CAN and Command tabs, verify the filters toggle visibility of events, and confirm the Events card remains visible. If the E2E suite does not exist yet, create minimal Playwright tests under `apps/dashboard-e2e/tests` using the same base URL and auth strategy described in the E2E plan, and run them as part of this work.

## Concrete Steps

All commands run from `E:\Projets\STM32\workspace\dashboard`.

After implementation, run the E2E suite:

  npm run e2e:up
  npm run e2e:prepare
  npm run e2e:test
  npm run e2e:down

If the E2E suite has not been bootstrapped yet, create it as described in this plan and then run the same commands.

## Validation and Acceptance

Acceptance is met when the Live Console page renders with a left vertical filter bar, the CAN and Command consoles appear as separate tabs, and the Events card shows a unified event stream with filters applied. On desktop, the layout must not require excessive vertical scrolling to access filters, tabs, and events. The CAN tab must support sending CAN frames, viewing live frames, and filtering by CAN ID; the Command tab must show a CLI-style log. The Events card must include all event types and support filtering by type and search. The E2E tests must run and pass, confirming tab switching and filter behavior.

## Idempotence and Recovery

The UI refactor is safe to re-run. If the layout change causes readability regressions, revert the layout changes in `apps/dashboard-web/src/pages/ConsolePage.tsx` and re-run tests. E2E tests should be repeatable against a fresh seed dataset.

## Artifacts and Notes

- Playwright report: `apps/dashboard-e2e/playwright-report` (17 tests passed).
- Test results: `apps/dashboard-e2e/test-results`.
- No manual before/after screenshot captured during this run.

## Interfaces and Dependencies

Update the Live Console UI in `apps/dashboard-web/src/pages/ConsolePage.tsx`. If helper components are introduced, place them in `apps/dashboard-web/src/components/console/` and keep them small and composable. Use `@mui/material` Tabs for the CAN/Command split and the existing `InfoCard` component for consistent styling. If a CAN bus load computation is introduced, place the helper in `apps/dashboard-web/src/pages/console/metrics.ts` or a similar co-located helper file and document its assumptions in the Decision Log.

Plan change note: Initial ExecPlan created on 2025-12-29 to refactor the Live Console UI for readability, tabs, and filtering, with E2E coverage mandated by `.agent/PLANS.md`.
Plan change note: Recorded decisions for bus load computation (requires known bitrate) and Events card placement (right column) on 2025-12-29.
