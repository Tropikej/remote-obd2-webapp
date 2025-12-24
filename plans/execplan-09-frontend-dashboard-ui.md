# Frontend Dashboard UI

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, a user can sign in, discover and pair dongles, configure CAN settings, create groups, and use live consoles from a production grade dashboard UI. The UI handles offline and degraded states, shows buffering status, and surfaces errors from the API using the standard error shape. You can see it working by running the web app, completing the pairing flow, creating a group, and opening the live console with SSE updates.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-24 11:40Z) Build the auth views and session bootstrap with CSRF support.
- [x] (2025-12-24 11:40Z) Implement dongle inventory, pairing flow, and CAN config forms.
- [x] (2025-12-24 11:40Z) Implement group creation, activation, and degraded state UI.
- [x] (2025-12-24 11:40Z) Implement live console views with SSE and reconnect behavior.
- [x] (2025-12-24 11:40Z) Implement admin pages for audit logs and user disable.

## Surprises & Discoveries

- Admin endpoints for user disable and audit log listing are not exposed by the API router; the UI degrades gracefully and surfaces errors instead of failing silently.

## Decision Log

- Decision: Centralize API calls and error handling in a single client module with CSRF handling.
  Rationale: It keeps CSRF logic consistent and makes the UI simpler to reason about.
  Date/Author: 2025-12-22 / Codex
- Decision: Use a small state store or React context for auth and live stream state instead of global state management frameworks unless the app already uses one.
  Rationale: The dashboard has limited complexity and should avoid unnecessary dependencies.
  Date/Author: 2025-12-22 / Codex
- Decision: Frontend admin tools remain in place even when backing endpoints are unavailable, showing actionable error feedback to super admins.
  Rationale: Keeps the UI contract visible and ready for when the API lands while avoiding hidden failures.
  Date/Author: 2025-12-24 / Codex

## Outcomes & Retrospective

Auth, dongle inventory, pairing, CAN config, group management, live console (SSE with reconnect and Last-Event-ID), and admin tooling screens are implemented. Admin disable/audit flows depend on future API routes; the UI reports missing endpoints instead of failing silently.

## Context and Orientation

The web app lives under `apps/dashboard-web` and is built with Vite and TypeScript. It consumes the Cloud API under `/api/v1` and uses SSE for live console streams. The UI must handle CSRF tokens for unsafe requests and display errors using the API standard error shape. The design should remain consistent with any existing UI patterns in the repo. If no design system exists, the UI should be clean and functional with clear status and warning states.

Key files likely include `apps/dashboard-web/src/main.tsx`, `apps/dashboard-web/src/api/client.ts`, `apps/dashboard-web/src/routes`, and `apps/dashboard-web/src/components` for shared UI elements.

## Plan of Work

Implement the authentication views. Provide signup, login, and logout flows. On app start, call `/api/v1/auth/me` to determine session state and fetch a CSRF token via `/api/v1/auth/csrf` to store in the API client for subsequent unsafe requests.

Implement the dongle inventory view. List dongles from `/api/v1/dongles`, show ownership state, last seen, and online status. Provide a pairing flow that displays discovered dongles, allows the user to request pairing mode, shows a countdown based on `expires_at`, and submits the PIN. Display security hold errors and guidance when pairing is blocked.

Implement the CAN configuration view. Allow editing and applying the config for a dongle. Display the last applied config and show success or error messages after apply. Ensure validation for numeric fields and mode selection.

Implement group management. Provide a group creation form that selects two owned dongles, enforces the two dongle constraint, and shows active or degraded status. Add activate and deactivate actions and show buffering state when a group is degraded. Display which side is offline and show backlog counts.

Implement live console views for dongles and groups. Create an SSE client that automatically reconnects and passes `Last-Event-ID` when available. Render CAN frame events with filters, include a rate indicator, and show `stream_reset` events when history is lost. Include command status events and log events.

Implement admin views for super admins. Provide a user list with disable action, a dongle list with force unpair action, and an audit log list with filters by action and date.

## Concrete Steps

Review the existing `apps/dashboard-web` structure and identify the routing system in use. Add route components for Auth, Dongles, Groups, Console, and Admin. Create a shared API client in `apps/dashboard-web/src/api/client.ts` that injects CSRF tokens and handles the standard error response, returning typed errors for the UI.

Create reusable components for status badges, online presence, and error toasts. Add an SSE hook in `apps/dashboard-web/src/hooks/useSse.ts` that manages connection, reconnection, and `Last-Event-ID` handling.

Wire the dongle and group pages to the API endpoints, and wire the console views to the SSE endpoints. Ensure all form submits pass the CSRF header and show errors when the API responds with a non 2xx response.

## Validation and Acceptance

Run the web app and verify that you can sign up, log in, and log out. Visit the dongle inventory page and confirm it lists devices and updates online status. Pair a dongle and confirm the ownership state changes. Create a group and observe its status. Open a dongle console and verify that SSE events appear and reconnect after a refresh. Confirm admin pages are hidden from non admin users and accessible to super admins.

## Idempotence and Recovery

UI changes are safe to re apply. If API calls fail, the UI should show a non fatal error message and allow retry. If SSE disconnects, it should reconnect automatically and show a transient warning if it had to reset.

## Artifacts and Notes

Example UI error message derived from API response:

    Pairing failed: PAIRING_PIN_INVALID. Please verify the PIN and try again.

## Interfaces and Dependencies

In `apps/dashboard-web/src/api/client.ts`, define functions `getAuthMe()`, `getCsrf()`, `listDongles()`, `startPairingMode(dongleId)`, `submitPairing(payload)`, `applyCanConfig(dongleId, config)`, `createGroup(payload)`, `activateGroup(groupId)`, `deactivateGroup(groupId)`, and `sendCommand(dongleId, payload)`.

In `apps/dashboard-web/src/hooks/useSse.ts`, define a hook `useSse(url)` that returns a stream of events with typed payloads and handles `stream_reset` events.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
