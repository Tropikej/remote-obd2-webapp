# Bridge Agent Remote API Switching

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

The bridge agent should connect to a VPS-hosted dashboard API without hard-coded localhost defaults and allow fast switching between remote and local endpoints during prototyping. After this change, a user can set the API base URL and dashboard web URL from the agent UI, persist them across restarts, and switch between recent endpoints with one click. The user can verify success by seeing the new URL in the agent status card, opening the tray menu dashboard link to the correct site, and confirming the agent connects to the VPS.

## Progress

- [x] (2026-01-03 09:59Z) Extend agent configuration and status to persist API and dashboard URLs plus recent API history.
- [x] (2026-01-03 09:59Z) Add IPC wiring and controller methods to update URLs safely and persist changes.
- [x] (2026-01-03 09:59Z) Add renderer settings UI with quick switching and error handling.
- [x] (2026-01-03 09:59Z) Update Playwright coverage and root test script; run validation.

## Surprises & Discoveries

- Observation: The packaged agent defaults to `http://localhost:3000` for API requests because the only configurable path is `process.env.API_BASE_URL`, which is not reliable in Windows Electron packaging.
  Evidence: `apps/bridge-agent/src/agent-core.ts` sets `apiBaseUrl` from env or falls back to `http://localhost:3000` and does not expose a UI configuration path.
- Observation: Playwright’s webServer output includes a Vite CJS deprecation warning during renderer tests.
  Evidence: `The CJS build of Vite's Node API is deprecated` printed during `npm run test:bridge-agent-ui`.

## Decision Log

- Decision: Store API base URL, dashboard web URL, and a recent-URL history in the existing agent config JSON file and expose them in the UI.
  Rationale: This keeps configuration persistent across packaged runs and makes switching between local and remote endpoints a single click without relying on environment variables.
  Date/Author: 2026-01-03 / Codex

- Decision: When the API base URL changes, clear stored credentials and require a new login.
  Rationale: Agent tokens and WebSocket URLs are tied to the API origin, so reusing them after a host change is unsafe and often fails.
  Date/Author: 2026-01-03 / Codex

- Decision: Render the server settings card even when login is required.
  Rationale: Users must be able to correct an incorrect API URL without first authenticating.
  Date/Author: 2026-01-03 / Codex

## Outcomes & Retrospective

Implemented persistent API/dashboard settings for the bridge agent, including quick switching between recent endpoints, and added IPC plumbing for updates. The tray dashboard link now respects configured URLs, and the renderer exposes a settings card on both login and status views. Tests: `npm run test:bridge-agent-ui`.

## Context and Orientation

The bridge agent is an Electron app in `apps/bridge-agent`. The core agent controller lives in `apps/bridge-agent/src/agent-core.ts` and loads configuration from `apps/bridge-agent/src/config/store.ts`, which persists to `%APPDATA%/obd2-dashboard-agent/config.json` on Windows. The renderer UI is in `apps/bridge-agent/src/desktop/renderer/App.tsx` and receives status via IPC defined in `apps/bridge-agent/src/desktop/preload.ts` and `apps/bridge-agent/src/desktop/main.ts`.

The API base URL currently defaults to `http://localhost:3000` when no environment variable is set. The tray menu uses `DASHBOARD_WEB_URL` or `http://localhost:5173` for the dashboard link and is not configurable through the UI.

## Plan of Work

Extend `AgentConfig` in `apps/bridge-agent/src/config/store.ts` to include `dashboardWebUrl` and `apiBaseUrlHistory`, and ensure these fields are persisted and read safely. Update `apps/bridge-agent/src/agent-core.ts` to track `dashboardWebUrl` and `recentApiBaseUrls` in `AgentStatus`, and to initialize them from configuration or defaults. Add a controller method to update settings that normalizes and validates URLs, updates the status fields, persists config, and clears credentials only when the API base URL changes. Keep discovery, heartbeat, and reporting behavior unchanged.

Add IPC support in `apps/bridge-agent/src/desktop/main.ts` and `apps/bridge-agent/src/desktop/preload.ts` for updating settings, returning a success or error payload. Use the status’s `dashboardWebUrl` to open the dashboard from the tray menu so it reflects updates.

Update the renderer UI in `apps/bridge-agent/src/desktop/renderer/App.tsx` to include a "Server settings" card with fields for API base URL and dashboard web URL, a Save action, and quick buttons for common endpoints (local defaults plus a list of recent endpoints). If a settings save fails, display a clear error. Update the dev stub in `apps/bridge-agent/src/desktop/renderer/main.tsx` to handle the new IPC method and maintain the new status fields.

Extend the Playwright test in `apps/bridge-agent/tests/agent-ui.spec.ts` to exercise the settings flow (setting a new API URL and verifying it appears in the status card). Add a root script (e.g., `test:bridge-agent-ui`) that runs the Playwright test via the workspace.

## Concrete Steps

All commands run from `E:\Projets\STM32\workspace\dashboard`.

1. Implement the configuration, IPC, and UI changes described above.
2. Run the UI test:

  npm run test:bridge-agent-ui

Expected output (example):

  Running 2 tests using 1 worker
    ✓ bridge agent renderer › login flow renders status (3s)
    ✓ bridge agent renderer › server settings updates api url (2s)
  2 passed

## Validation and Acceptance

Acceptance is met when the agent UI shows the new API base URL after saving settings, the tray "Open Dashboard" menu opens the configured dashboard URL, and switching between a remote URL and `http://localhost:3000` works without reinstalling or editing files. The Playwright UI test must pass and cover the settings update flow.

## Idempotence and Recovery

Saving the same URLs repeatedly is safe. To revert to defaults, delete `%APPDATA%/obd2-dashboard-agent/config.json` and relaunch the agent. If a bad URL is saved, update it through the settings UI or delete the config file to reset.

## Artifacts and Notes

Example config file after setting URLs:

  {
    "apiBaseUrl": "https://baltringuelabs.cam",
    "dashboardWebUrl": "https://baltringuelabs.cam",
    "apiBaseUrlHistory": [
      "https://baltringuelabs.cam",
      "http://localhost:3000"
    ]
  }

## Interfaces and Dependencies

Add or extend these interfaces and modules:

- `apps/bridge-agent/src/config/store.ts` must include `dashboardWebUrl?: string` and `apiBaseUrlHistory?: string[]` in `AgentConfig`.
- `apps/bridge-agent/src/agent-core.ts` must add `dashboardWebUrl` and `recentApiBaseUrls` to `AgentStatus`, and implement a settings update method that validates URLs and persists config.
- `apps/bridge-agent/src/desktop/main.ts` must expose an IPC handler for settings updates and use the status dashboard URL in the tray menu.
- `apps/bridge-agent/src/desktop/preload.ts` must expose `updateSettings` in `window.agentApi`.
- `apps/bridge-agent/src/desktop/renderer/App.tsx` must render the new settings UI and handle updates.
- `apps/bridge-agent/src/desktop/renderer/main.tsx` must update the dev stub for settings and status fields.
- `apps/bridge-agent/tests/agent-ui.spec.ts` must add a settings update test.
- Root `package.json` must add a `test:bridge-agent-ui` script that runs the Playwright tests for the bridge agent.

Plan change note: Initial ExecPlan created on 2026-01-03 to add remote API switching and settings UI for the bridge agent.
Plan change note: 2026-01-03 - Completed implementation, updated progress/outcomes, and recorded Playwright warning observed during validation.
