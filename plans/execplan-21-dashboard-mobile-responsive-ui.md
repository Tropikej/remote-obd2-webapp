# Mobile-first responsive UI for the dashboard

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan must be maintained in accordance with `.agent/PLANS.md` from the repository root.

## Purpose / Big Picture

Ship a mobile-first, responsive UI so the dashboard is usable on small screens without breaking desktop layouts. The primary outcomes are a hamburger navigation drawer on mobile, single-column layouts on narrow viewports, and forms/actions that remain accessible without horizontal scrolling.

## Progress

- [x] (2026-01-02 14:22Z) Audit layout and shared UI components to identify responsive gaps.
- [x] (2026-01-02 14:22Z) Implement mobile navigation drawer and responsive container spacing.
- [x] (2026-01-02 14:22Z) Update page layouts (Dongles, Groups, Dongle detail, Console, Admin, Auth) to be mobile-first.
- [x] (2026-01-02 14:22Z) Add E2E coverage for mobile navigation/responsiveness and update selectors.
- [x] (2026-01-02 14:22Z) Run the E2E suite and capture results.

## Surprises & Discoveries

- None observed during implementation.

## Decision Log

- Decision: Keep a single source of truth for navigation items and render them for both desktop and mobile layouts.
  Rationale: Prevents drift between layouts and keeps behavior consistent.
  Date/Author: 2025-02-14 / Codex
- Decision: Use MUI breakpoints with mobile-first `sx` styles instead of separate mobile components.
  Rationale: Preserves a single UI code path while adapting layout across viewports.
  Date/Author: 2025-02-14 / Codex
- Decision: Add a Playwright mobile-viewport test that validates the hamburger drawer and navigation links.
  Rationale: Ensures the new responsive navigation is exercised end-to-end.
  Date/Author: 2026-01-02 / Codex

## Outcomes & Retrospective

- Mobile-first responsive updates are in place across the layout, shared UI components, and all main pages. The E2E suite now includes mobile navigation coverage and passes locally.

## Context and Orientation

The dashboard web UI is in `apps/dashboard-web`. The top-level layout and navigation live in `apps/dashboard-web/src/components/Layout.tsx`. Auth screens use `AppShell` from `packages/ui/src/components/AppShell.tsx`. Reusable cards are `packages/ui/src/components/InfoCard.tsx`. Individual pages live in `apps/dashboard-web/src/pages` (Dongles, Groups, Dongle detail, Console, Admin, Login, Signup). Styling is primarily via MUI `sx` props and the shared theme in `packages/ui/src/theme.tsx`.

End-to-end tests live in `apps/dashboard-e2e/tests` and selectors in `apps/dashboard-e2e/helpers/selectors.ts`. The E2E suite uses Playwright and a seeded environment; new mobile responsive behavior must be exercised in this suite.

## Plan of Work

Update the shared layout to introduce a hamburger menu for mobile and keep a single set of navigation metadata that drives both the desktop nav buttons and the mobile drawer list. Adjust global container spacing to be mobile-first while preserving desktop widths.

Tighten the shared `AppShell` and `InfoCard` components to reduce padding and typography scale on narrow viewports. This ensures auth and card-based layouts look balanced on phones without diverging from desktop design.

Revise each page layout to stack actions and form controls vertically on small screens. This includes button rows, stacked controls (like pairing and CAN console forms), and grid columns that should collapse to single-column layouts on `xs`.

Add a new Playwright test that runs on a mobile viewport to verify the hamburger menu appears, nav items are reachable, and navigation works. Update selectors to reference the hamburger trigger and any new UI hooks.

## Concrete Steps

From the repository root (`E:\Projets\STM32\workspace\dashboard`):

1. Edit layout and shared UI components.
2. Edit page-level layouts to use mobile-first breakpoints.
3. Add Playwright test(s) in `apps/dashboard-e2e/tests` and update `apps/dashboard-e2e/helpers/selectors.ts`.
4. Run:

   - `npm run e2e:up`
   - `npm run e2e:prepare`
   - `npm run e2e:test`

Expected result: all E2E tests pass, including the new responsive/mobile navigation test.

## Validation and Acceptance

The UI is responsive on small screens (e.g. 390x844). The mobile navigation drawer is reachable and contains all app links. Forms and action buttons are usable without horizontal scrolling. Desktop layouts remain intact and do not lose navigation links. The Playwright E2E suite includes a test that opens the mobile drawer, verifies navigation items, and successfully navigates between pages.

## Idempotence and Recovery

UI changes are additive and can be applied repeatedly. If a change causes layout regressions, revert the specific component file and rerun the E2E suite. The E2E environment can be restarted with `npm run e2e:down` followed by `npm run e2e:up`.

## Artifacts and Notes

- E2E: `npm run e2e:test` => 15 passed (4.9s).

## Interfaces and Dependencies

Use MUI `Drawer`, `IconButton`, `List`, and breakpoint-aware `sx` styling in `apps/dashboard-web/src/components/Layout.tsx`. Maintain nav identifiers in `apps/dashboard-e2e/helpers/selectors.ts` for automated tests. Use existing shared UI components (`AppShell`, `InfoCard`, `PrimaryButton`) and update them rather than creating separate mobile-only variants.

Plan Update Notes:
- 2025-02-14: Initial plan created to guide responsive UI implementation.
- 2026-01-02: Updated progress, outcomes, and artifacts after implementing responsive UI changes and running E2E tests.
