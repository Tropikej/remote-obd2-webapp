# Dashboard/Agent CAN Transport and Dongle CLI Control

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `dashboard/.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the dashboard can send CAN frames to a paired dongle, display all CAN frames coming back from the dongle without data-plane filtering, apply CAN configuration remotely, and run safe dongle CLI commands from the web console. You can see it working by pairing a dongle, starting CAN traffic (real or simulated), watching frames appear in the console, sending a CAN frame from the UI, and issuing a CLI command with a visible response.

## Progress

- [x] (2025-12-29 20:00Z) Extend `@dashboard/remp` with CAN and CLI encode/decode helpers.
- [x] (2025-12-29 20:00Z) Add a shared UDP transport in the bridge agent for REMP send/receive.
- [x] (2025-12-29 20:00Z) Always forward dongle CAN frames to the API, then relay to grouped dongles when applicable.
- [x] (2025-12-29 20:00Z) Implement REMP CAN-config in the agent and surface results in the API/UI.
- [x] (2025-12-29 20:00Z) Implement dongle CLI command execution via the agent and show responses in the dashboard console.
- [x] (2025-12-29 20:00Z) Update the console UI with a command input/log panel and a CAN send/traffic panel.
- [x] (2025-12-29 20:30Z) Align dongle token encoding so pairing, CAN, and CLI all use the same 32-byte token on the wire (base64 at API boundaries, raw bytes in REMP).
- [x] (2026-01-02 22:00Z) Validate CAN TX/RX and remote CLI over a paired dongle.

## Surprises & Discoveries

- Observation: The bridge agent has no UDP listener for REMP CAN frames and cannot send CAN frames to the dongle.
  Evidence: `dashboard/apps/bridge-agent/src` contains UDP only for discovery and pairing tests.
- Observation: CAN configuration over REMP is a placeholder in the agent.
  Evidence: `dashboard/apps/bridge-agent/src/remp/can-config.ts` returns the input config without network I/O.
- Observation: The data-plane WebSocket currently expects group-based CAN frames only.
  Evidence: `dashboard/packages/shared/src/protocols/can-relay.ts` requires `group_id`, and `dashboard/apps/dashboard-api/src/ws/data-plane.ts` drops frames without a group.
- Observation: The console UI shows command status events but does not distinguish dongle vs agent command sources.
  Evidence: `dashboard/apps/dashboard-web/src/pages/ConsolePage.tsx` renders `command_status` without a source/target tag.
- Observation: The bridge agent discovery cache keys by device_id while control messages use dongle database ids.
  Evidence: `dashboard/apps/bridge-agent/src/agent-core.ts` looked up discovery snapshots by `dongle_id` from control messages.
- Observation: The bridge agent had no handler for `command_request` control messages.
  Evidence: `dashboard/apps/bridge-agent/src/agent-core.ts` only handled CAN config and pairing requests.
- Observation: Pairing succeeds, but later REMP traffic fails because the agent sends UTF-8 base64 strings while the dongle expects raw token bytes.
  Evidence: UART logs show `token reject rx_len=32 exp_len=32` after pairing; `GET /api/v1/agents/dongles/:id/token` returns base64, and the agent passes it through as UTF-8.

## Decision Log

- Decision: Use a single long-lived UDP socket in the agent for all REMP traffic (pairing, CAN, CAN config, CLI) so the dongle can reply to the same port.
  Rationale: The dongle’s peer-learning uses the source port of inbound packets, so a stable socket avoids mismatched ports.
  Date/Author: 2025-12-29 / Codex
- Decision: Always forward CAN frames from the dongle to the API, and let the API decide whether to relay them to a paired group.
  Rationale: The dongle should not need to know group membership; the server is the source of truth.
  Date/Author: 2025-12-29 / Codex
- Decision: Fetch the decrypted dongle token from the API on demand and cache it in memory in the agent.
  Rationale: The agent needs the token to send authenticated REMP frames; the token should never be written to disk.
  Date/Author: 2025-12-29 / Codex
- Decision: Reuse the existing command pipeline, but add explicit `command_target` and `command_source` fields so the UI can label dongle vs agent commands.
  Rationale: The console should show where a command ran; storing the target/source makes filtering and auditing possible.
  Date/Author: 2025-12-29 / Codex
- Decision: Store command output in the database with a fixed size cap and a `truncated` flag.
  Rationale: Persisting every byte is unsafe for the DB; a cap preserves auditability while preventing unbounded growth.
  Date/Author: 2025-12-29 / Codex
- Decision: Allow dangerous CLI commands only when the user enables a UI checkbox and the API is configured for dev mode.
  Rationale: The default path stays safe, but labs can enable deeper access explicitly.
  Date/Author: 2025-12-29 / Codex
- Decision: Do not sample or filter data-plane CAN frames in the agent or API; only the console stream may apply sampling for UI rendering.
  Rationale: The system must preserve full-fidelity CAN traffic and handle scaling at the server rather than dropping frames client-side.
  Date/Author: 2025-12-29 / Codex
- Decision: Treat dongle tokens as binary data on the wire (32 bytes) and use base64 only at API boundaries, decoding before building REMP headers or payloads.
  Rationale: The firmware compares token bytes and length; sending base64 strings changes length and breaks authentication.
  Date/Author: 2025-12-29 / Codex

## Outcomes & Retrospective

- Implemented REMP transport, CAN relay, CAN config, and dongle CLI support across agent, API, and UI; validation completed with live dongle.
- Tests have not been run yet.

## Validation Status

- Tests have not been run yet.
- Manual validation completed (2026-01-02):
  - Confirmed bridge-agent data-plane WS connected (`[bridge-agent] data-plane connected to ws://127.0.0.1:3000/ws/data`).
  - Confirmed CAN TX sends via REMP (`remp can tx` logs) and dongle responses observed.
  - Confirmed CLI REMP response matched (`remp matched type=4`).
  - Console UI shows CAN frames and CLI output after re-pairing and data-plane reconnection.
- Detailed tests to run and what they validate:
  - Run `npm run dev:api` and `npm run dev:desktop --workspace apps/bridge-agent` to validate the feature "all new REMP API + agent paths compile and start without runtime errors".
  - Pair a dongle and verify CAN RX traffic appears in the console stream to validate the feature "dongle CAN frames are forwarded to the API and visible in the dashboard".
  - Send a CAN frame from the dashboard and verify `remote stats` increments RX to validate the feature "dashboard CAN TX reaches the dongle over REMP".
  - Apply a CAN config change and confirm the UI shows the dongle-applied config to validate the feature "CAN config over REMP with applied config returned".
  - Run a dongle CLI command (ex: `remote status`) and confirm output appears in the console to validate the feature "dongle CLI execution via REMP with output streaming".
  - Run `remote pairing show` and confirm `token_len=32` to validate the feature "token encoding alignment for pairing/CAN/CLI".

## Cross-Repo Link

This executive plan is linked to `remote-obd2-firmware-h753/plan/remp-can-cli-transport-execplan.md` in the embedded firmware repository.

## Context and Orientation

The bridge agent connects to the API over a control WebSocket (`dashboard/apps/bridge-agent/src/ws/control.ts`) and a data-plane WebSocket (`dashboard/apps/bridge-agent/src/ws/data-plane.ts`). The API uses the control channel to send pairing and configuration requests. The data-plane is used for CAN frame relaying between dongle groups in `dashboard/apps/dashboard-api/src/ws/data-plane.ts`.

The shared REMP utilities live in `dashboard/packages/remp/src`. Today this package only implements pairing. The firmware expects REMP frames for CAN and CAN config, and it will only accept CAN/CLI traffic with a valid token. The token is stored encrypted in the API database and must be provided to the agent when it needs to send authenticated frames.

The console UI is in `dashboard/apps/dashboard-web/src/pages/ConsolePage.tsx`. It already streams CAN frames and command status events via SSE, but the backend never emits those events for ungrouped dongles and the agent does not execute dongle CLI commands yet. A “dongle group” is a database record that links two dongles for CAN relaying; `group_id` identifies that relationship, but the dongle should always report frames to the server regardless of grouping.

## Plan of Work

Extend `dashboard/packages/remp` with REMP CAN and CLI helpers. Add functions to build the REMP header, encode a CAN frame payload, decode a CAN frame payload, encode CAN-config requests and responses, and encode/decode the CLI request/response payload defined in the firmware plan `remote-obd2-firmware-h753/plan/remp-can-cli-transport-execplan.md`. Keep these helpers small and pure so they can be unit-tested without network access.

Add a new UDP transport module in `dashboard/apps/bridge-agent/src/remp/transport.ts` that owns a single `dgram` socket. It should send REMP packets to a dongle’s LAN IP and UDP port, listen for incoming REMP packets, and expose callbacks for CAN frames and CLI responses. Keep the socket open for the lifetime of the agent so the dongle replies to the same source port.

Add token retrieval. Create an API route (for example, `GET /api/v1/agents/dongles/:id/token`) that returns the decrypted dongle token only to the agent that last saw the dongle. The agent should request and cache the token in memory with a short TTL (for example, 5 minutes) and refresh it on cache miss. Never store the token on disk.

Align token encoding between pairing and REMP traffic. The API should produce a base64 token string that represents 32 raw bytes. In `dashboard/packages/remp/src/pairing.ts`, decode the token from base64 before writing it into the pairing submit payload. In `dashboard/apps/bridge-agent/src/agent-core.ts`, `dashboard/apps/bridge-agent/src/remp/can-config.ts`, and `dashboard/apps/bridge-agent/src/remp/cli.ts`, decode the base64 token into raw bytes before passing it into `encodeRempHeader`. This ensures `token_len` is 32 everywhere and matches the token stored on the dongle. After changing encoding, re-pair the dongle so the on-device token matches the DB token.

Wire CAN frames to the data-plane. Update `dashboard/packages/shared/src/protocols/can-relay.ts` so the agent can send dongle-scoped CAN frames without `group_id`. In `dashboard/apps/dashboard-api/src/ws/data-plane.ts`, always publish incoming frames to the `dongle:<id>` SSE stream. If the dongle is in a group, look up the group and relay the frame to the other dongle's agent on the data plane; keep group relay behavior in the server, not the agent. Do not sample or filter data-plane CAN frames in the agent or API; only the console SSE stream may be sampled for UI rendering.

Add CAN send support. Create an API endpoint such as `POST /api/v1/dongles/:id/can/send` that validates ownership, validates the CAN frame payload, and sends a control request to the agent. Update `dashboard/apps/bridge-agent/src/agent-core.ts` to handle `can_frame_send` control messages by encoding a REMP CAN frame using the cached token and sending it over the UDP transport to the dongle.

Implement CAN config over REMP. Replace the placeholder in `dashboard/apps/bridge-agent/src/remp/can-config.ts` with real UDP requests that use the REMP CAN-config payload. Return the applied configuration from the dongle’s response. Update `dashboard/apps/dashboard-api/src/services/can-config.ts` to store the applied configuration from the agent response.

Implement dongle CLI execution. Add new fields in the API command payload and DB schema: `command_target` (`"agent"` | `"dongle"`) and `command_source` (`"web"` | `"agent"` | `"system"`). The console UI should send dongle-targeted commands when the user selects a dongle. Add a checkbox to allow dangerous commands; only send it when the API is in dev mode. In the agent, handle `command_request` messages with `command_target: "dongle"` by sending a REMP CLI request to the dongle and streaming the response back as `command_chunk` and a final `command_response`. Store stdout/stderr in the database with a fixed size cap (for example 64 KB) and set a `truncated` flag when output exceeds the cap. Keep the allowlist in `dashboard/apps/dashboard-api/src/services/commands.ts` synchronized with the firmware allowlist.

Update the console UI (`dashboard/apps/dashboard-web/src/pages/ConsolePage.tsx`) with:
1) A command input panel (command name + args) and a scrollable log view that shows both sent commands and received outputs with a `source` tag.
2) A CAN panel that can send frames (CAN ID, payload hex, one-shot or periodic with interval ms) and a live CAN traffic table showing CAN ID, direction (tx/rx), DLC, and payload.

## Concrete Steps

All commands run from `E:\Projets\STM32\workspace\dashboard`.

Start the stack for manual validation:

  npm run dev:stack
  npm run dev:desktop --workspace apps/bridge-agent

If you need the web UI separately:

  npm run dev --workspace apps/dashboard-web

## Validation and Acceptance

Pair a dongle and ensure the agent sees it. Then:

1) Generate CAN RX traffic on the dongle (hardware bus or `can_sim` on UART) and verify CAN frames appear in the console’s live stream for the dongle target.
2) Send a CAN frame from the dashboard using the new UI action or API endpoint and verify the dongle’s `remote stats` shows `rx` increments.
3) Apply a CAN configuration change in the dashboard and verify the dongle responds with the applied config (the UI should show the effective config from the dongle).
4) Run a dongle CLI command such as `remote status` from the console and verify the response text appears as a command result event.
5) Run `remote pairing show` on UART and confirm `token_len=32`, then send a CAN frame from the dashboard and confirm the dongle no longer logs `token reject`.

Acceptance is met when CAN frames flow in both directions and at least one dongle CLI command returns output within the configured timeout.

## Idempotence and Recovery

The UDP transport is safe to reinitialize; it should rebind cleanly on restart. Token retrieval is read-only and cached in memory; restarting the agent re-fetches tokens. If the API endpoint is unavailable, the agent should surface an error to the control channel and the UI should display a failure message without altering dongle state.

## Artifacts and Notes

Capture one console transcript showing a CAN frame event and a CLI command response, plus a short agent log snippet showing a decoded REMP CAN frame. These artifacts prove the data plane is wired end to end.

## Interfaces and Dependencies

In `dashboard/packages/remp/src`, define helper functions such as:

  export const encodeRempHeader(...)
  export const encodeCanFrame(...)
  export const decodeCanFrame(...)
  export const encodeCanConfigRequest(...)
  export const decodeCanConfigResponse(...)
  export const encodeCliRequest(...)
  export const decodeCliResponse(...)

In `dashboard/apps/bridge-agent/src/agent-core.ts`, handle new control messages:

  type: "can_frame_send"
  type: "command_request" with target "dongle"

In `dashboard/apps/dashboard-api/src/ws/data-plane.ts`, accept dongle-scoped CAN frames with no `group_id` and publish them to `dongle:<id>` SSE; keep group-scoped routing unchanged.

In `dashboard/apps/dashboard-api/src/routes/dongles.ts`, add a CAN send endpoint that validates ownership and sends `can_frame_send` to the agent.

Plan change note: 2025-12-29 - Updated the plan to route all CAN frames through the server, add console UI requirements, and add command target/source + capped log storage with a dangerous-command toggle.
Plan change note: 2025-12-29 - Clarified that data-plane CAN frames must not be sampled or filtered in the agent or API.
Plan change note: 2025-12-29 - Added token encoding alignment steps and validation to prevent REMP auth failures after pairing.
Plan change note: 2026-01-02 - Added BRIDGE_AGENT_DEBUG_* and DASHBOARD_DEBUG_* logging flags for prototyping only; keep disabled or remove before production.
Plan change note: 2026-01-02 - Manual validation completed with live dongle (CAN TX/RX + CLI output + data-plane WS connectivity).
