# Bridge Agent Desktop UI and Tray Workflow

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the Bridge Agent is a real desktop tray app that lets a user log in with their dashboard credentials, see whether the agent is connected, and control key actions from the tray menu. The desktop UI is intentionally simple: login plus a status screen, while most actions live in the tray menu. The renderer uses the same UI components as the main dashboard web app, based on Google’s Material Design component library, so the visual language and component primitives are shared. The repository also includes a Windows packaging step using electron-builder with NSIS so the agent can be distributed as an installer. You can see it working by running the agent in dev mode, entering credentials in the login screen, watching the agent register with the API, and using the tray menu to open the status window, copy the agent ID, or quit. You can also package it by building the installer and confirming the NSIS artifact is created.

## Progress

- [x] (2025-12-23 09:30Z) Draft the shared UI component package and convert the dashboard web placeholder to use it.
- [x] (2025-12-23 09:30Z) Add Electron main + tray wiring for the bridge agent with IPC and a renderer UI.
- [x] (2025-12-23 09:30Z) Implement login and status screens using shared components and wire them to the agent core.
- [x] (2025-12-23 09:30Z) Add tray menu actions for most workflows and ensure actions work when the window is closed.
- [x] (2025-12-23 09:30Z) Add tests and manual verification steps for UI, tray menu, and registration flow.
- [x] (2025-12-23 10:00Z) Add electron-builder packaging for Windows (NSIS) with future-proof config placeholders for macOS and Linux.

## Surprises & Discoveries

- Observation: Vite cannot resolve workspace packages that only export built artifacts, so the desktop renderer and web app need an alias to the UI package source path.
  Evidence: `Failed to resolve entry for package "@dashboard/ui"` when running the renderer tests before adding the alias.
- Observation: Electron-builder uses the default Electron icon when no application icon is configured.
  Evidence: Packaging log shows `default Electron icon is used`.

## Decision Log

- Decision: Use Electron for the desktop shell and React + MUI (Material UI) for the renderer.
  Rationale: The spec calls for a Node/TypeScript tray app; Electron matches that runtime and supports a tray icon. MUI is a Google-backed component library that can be shared with the dashboard web UI to satisfy the “Google UI components” requirement.
  Date/Author: 2025-12-23 / Codex
- Decision: Keep the agent core headless and expose a narrow IPC surface to the renderer.
  Rationale: This keeps secrets in the main process, allows the tray menu to operate without a visible window, and preserves the CLI mode for headless testing.
  Date/Author: 2025-12-23 / Codex
- Decision: Alias `@dashboard/ui` to the source tree in Vite configs.
  Rationale: It allows the renderer and dashboard web app to import shared components without requiring a pre-build step.
  Date/Author: 2025-12-23 / Codex
- Decision: Use electron-builder with an NSIS target for the first packaging pass.
  Rationale: NSIS is a standard Windows installer format, and electron-builder supports extending to macOS and Linux later with minimal config changes.
  Date/Author: 2025-12-23 / Codex

## Outcomes & Retrospective

The repository now includes a shared `packages/ui` component library based on Material UI, a React-based placeholder dashboard web app using those components, and a desktop Electron shell for the bridge agent with login and status screens. The tray menu exposes the required actions, IPC keeps secrets in the main process, and automated smoke tests cover the shared UI and renderer login/status flows. Packaging via electron-builder with NSIS is implemented; `npm run package:win --workspace apps/bridge-agent` produces an installer under `apps/bridge-agent/dist/installer/`.

Plan change note: Marked all steps complete after adding the UI package, Electron shell, renderer screens, tray actions, and tests; documented the Vite alias requirement to keep workspace package resolution reliable in dev/test.

## Context and Orientation

The Bridge Agent lives in `apps/bridge-agent`. It currently runs as a headless Node process with discovery, registration, and reporting implemented in `apps/bridge-agent/src`. The discovery protocol is in `packages/shared/src/protocols/discovery.ts`. The dashboard web app lives in `apps/dashboard-web` and is currently a static placeholder. The spec in `doc/new-dashboard-spec-v0.7.md` mandates a desktop tray app for the agent and calls out the API endpoints the agent uses. ExecPlan `plans/execplan-04-bridge-agent-discovery.md` implemented the agent core; this plan adds the desktop shell and UI while reusing that core.

Define “tray app” as a desktop application that runs in the system tray (the menu bar area), provides a tray menu for actions, and can show or hide a small window. Define “Electron main process” as the Node process that owns OS integrations (tray icon, IPC, file system). Define “renderer” as the browser-like UI layer that shows the login/status screens. Define “IPC” (inter-process communication) as the messaging bridge between the Electron main process and the renderer.

## Plan of Work

First, introduce a shared UI package in `packages/ui` that wraps MUI components and themes so both the dashboard web app and the agent renderer can import a consistent design system. Convert `apps/dashboard-web` to a minimal React + MUI app that renders a placeholder layout using the shared package. This ensures the “reuse the same web components” requirement is met and sets a foundation for `plans/execplan-09-frontend-dashboard-ui.md`.

Next, upgrade `apps/bridge-agent` into an Electron app with a tray icon. The Electron main process should live in `apps/bridge-agent/src/desktop/main.ts` and be responsible for creating the tray icon, launching or hiding the window, and starting the existing agent core. A preload script in `apps/bridge-agent/src/desktop/preload.ts` should define a narrow IPC API that lets the renderer ask for status, initiate login, and receive updates. Keep the existing CLI entry point `apps/bridge-agent/src/main.ts` so headless testing remains possible.

Then, implement a small renderer UI in `apps/bridge-agent/src/desktop/renderer` using React and the shared `packages/ui` components. The login screen should accept email and password, call a main-process IPC method to register the agent, and show success or error. After login, show a status screen with agent ID, API base URL, last heartbeat, and discovery status. The renderer must never store the password; only the main process stores the agent token in the config file created by `apps/bridge-agent/src/config/store.ts`.

Finally, fill out the tray menu to provide most user actions. The tray menu should include at least: show/hide window, connection status (read-only), open dashboard in the browser, copy agent ID, toggle discovery on/off, reset login (clears token and requires re-login), and quit. These actions should work even if the window is closed. When the user logs out or resets login, the main process should clear the saved token and update the renderer state.

After the desktop UI is working, add packaging using electron-builder. The first target is Windows with an NSIS installer, but the configuration should include placeholders for macOS and Linux to keep future work small. Ensure the packaging step builds the renderer and main process first, then produces an installer under a predictable output directory.

### Milestone 1: Shared UI foundation

At the end of this milestone, there is a new `packages/ui` workspace exporting a shared MUI theme and a small set of components (for example: `AppShell`, `PrimaryButton`, `TextField`, `StatusChip`, `EmptyState`). The dashboard web app has been converted to a minimal React app that uses these components so the UI stack is proven. Run the web app and confirm it renders with the shared theme.

### Milestone 2: Electron shell and tray menu

At the end of this milestone, `apps/bridge-agent` launches an Electron window and a tray icon, and the tray menu exposes the required actions. The agent core still runs headless in the main process and logs status. Opening and closing the window should not stop the agent core.

### Milestone 3: Login and status UI

At the end of this milestone, the renderer shows a login screen, registers the agent via IPC, and transitions to a status screen. Successful login stores the token, and the tray menu reflects the connection state. Errors (bad credentials, API offline) are shown in the UI with clear messages.

### Milestone 4: Validation and tests

At the end of this milestone, there are automated smoke tests for the shared UI components and renderer, plus documented manual steps for tray menu interactions. The automated tests run in a browser context against the renderer UI so they can run in CI without a full desktop session.

### Milestone 5: Windows packaging with NSIS

At the end of this milestone, the bridge agent can be packaged into a Windows installer using electron-builder. The packaging config uses NSIS for Windows and includes placeholder sections for macOS and Linux targets. A developer can run a single script to build the installer and find the resulting artifact under `apps/bridge-agent/dist/` or a configured output directory.

## Concrete Steps

From the repository root, create `packages/ui` with React, MUI, and a shared theme module. Update `apps/dashboard-web/package.json` to include React, React DOM, and the new UI package, then change `apps/dashboard-web/src/main.ts` to mount a React root that renders a simple page using the shared components. Add a new Vite React config if needed.

In `apps/bridge-agent`, add Electron dependencies and create `apps/bridge-agent/src/desktop/main.ts`, `apps/bridge-agent/src/desktop/preload.ts`, and `apps/bridge-agent/src/desktop/renderer/main.tsx`. Add `apps/bridge-agent/src/desktop/renderer/App.tsx` with login and status screens built on shared UI components. Update `apps/bridge-agent/package.json` with `dev:desktop` and `build:desktop` scripts that run the Electron main process and start the renderer with Vite.

Add IPC channels in the preload script for `login`, `logout`, `getStatus`, and `toggleDiscovery`. Implement these in the Electron main process by delegating to the existing agent core functions in `apps/bridge-agent/src/api/client.ts`, `apps/bridge-agent/src/discovery/index.ts`, and `apps/bridge-agent/src/config/store.ts`. Ensure IPC payloads are validated, and never pass the agent token to the renderer.

Add packaging with electron-builder by installing it in `apps/bridge-agent/package.json` and adding a `build` configuration block. Configure `appId`, `productName`, `files`, `directories.output`, and `win.target` as `nsis`. Add `mac` and `linux` blocks with a note that they are placeholders for future work. Add scripts such as `package:win` that run the renderer build, main build, then `electron-builder --win nsis`. Document how to run the packaging command and where to find the installer.

## Validation and Acceptance

Run the dashboard web app and confirm it renders using the shared UI components. Start the agent desktop app, open the login screen, and log in with a dashboard account. Confirm the agent registers successfully by seeing the API log a registration and by the UI showing an agent ID. Close the window and verify that tray menu actions still work. Toggle discovery off and on from the tray menu and confirm the agent logs reflect the change. Reset login from the tray menu and confirm the config file no longer contains the token and the UI returns to the login screen.

Automated tests should include a smoke test for `packages/ui` that renders key components and a renderer UI test that fills the login form in a browser context with a mocked IPC layer. The tests should fail before these components exist and pass after implementation.

Acceptance is achieved when the desktop agent can be run by a novice, login succeeds without editing files, the tray menu provides the required actions, and the shared UI components are used in both the web app and the agent UI.

Packaging acceptance is achieved when running the packaging command produces an NSIS installer and the output artifact name matches the configured `productName` and version. The installer should be created without interactive prompts and should be repeatable.

## Idempotence and Recovery

The UI setup steps are additive and safe to rerun. If Electron or Vite scripts fail, the steps should be repeatable after fixing the configuration without data loss. Clearing the agent login should only remove the stored token and agent ID; it should not delete unrelated config or logs.

Packaging is also repeatable. If the packaging step fails, delete the output directory and rerun the build scripts. Do not delete the developer's local config directory unless you explicitly need to reset credentials.

## Artifacts and Notes

Example log snippet after successful login:

  [bridge-agent] registering agent (missing token)
  [bridge-agent] heartbeat ok agent_id=...

Example tray menu labels:

  OBD2 Agent (Connected)
  Open Agent Window
  Open Dashboard
  Copy Agent ID
  Discovery: On
  Reset Login
  Quit

## Interfaces and Dependencies

In `packages/ui/src/theme.ts`, define and export a MUI theme and a `ThemeProvider` wrapper component. In `packages/ui/src/components`, export shared React components that are used by both the dashboard web app and the agent UI.

In `apps/bridge-agent/src/desktop/preload.ts`, define a `window.agentApi` interface with methods `login(credentials)`, `logout()`, `getStatus()`, `toggleDiscovery(enabled)`, and an event listener for status updates. The Electron main process in `apps/bridge-agent/src/desktop/main.ts` must implement these IPC channels and keep secrets on the main side.

The renderer entry point in `apps/bridge-agent/src/desktop/renderer/main.tsx` should mount a React root and render `App` from `apps/bridge-agent/src/desktop/renderer/App.tsx`, which uses the shared UI components and calls `window.agentApi` to log in and render status.

In `apps/bridge-agent/package.json` or a dedicated `apps/bridge-agent/electron-builder.yml`, define the electron-builder config with `appId`, `productName`, `directories`, `files`, and a Windows `nsis` target, plus placeholder `mac` and `linux` sections. Add a `package:win` script that runs the renderer build, main build, then electron-builder to produce the installer.

Plan change note: Initial version created on 2025-12-23 to cover the missing desktop agent login UI, tray workflows, and shared Google Material UI component reuse across the agent and dashboard web apps. Updated on 2025-12-23 to add electron-builder packaging with NSIS and a Windows-first distribution milestone.
