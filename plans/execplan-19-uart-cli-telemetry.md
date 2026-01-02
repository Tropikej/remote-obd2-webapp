# UART CLI Telemetry in Dashboard Console

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `dashboard/.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, UART CLI commands executed directly on a dongle are visible in the dashboard console and stored in the database. This gives remote owners and support staff visibility into local actions, enabling auditability and faster troubleshooting. You can see it working by pairing a dongle, typing `net status` on the UART console, and watching a `cli_telemetry` event appear in the web console with the same output.

## Progress

- [x] (2026-01-02 16:48Z) Verified the dashboard can run a dongle CLI command (`remote status`) over the existing REMP command pipeline; UART telemetry still pending.
- [ ] (2025-12-29 21:20Z) Add REMP type 5 decode helpers for UART CLI telemetry in `dashboard/packages/remp` (optional for now).
- [ ] (2025-12-29 21:20Z) Extend the bridge agent UDP listener to decode UART CLI telemetry and forward it to the API (optional for now).
- [ ] (2025-12-29 21:20Z) Add a `cli_telemetry` database table and API service to persist UART CLI events with output caps (optional for now).
- [ ] (2025-12-29 21:20Z) Publish `cli_telemetry` SSE events on dongle console streams and update the UI to display them (optional for now).
- [ ] (2025-12-29 21:20Z) Validate telemetry end-to-end with a paired dongle and confirm DB persistence (optional for now).

## Surprises & Discoveries

- Observation: None yet.
  Evidence: Not started.

## Decision Log

- Decision: Store UART CLI telemetry in a dedicated `cli_telemetry` table rather than reusing the `commands` table.
  Rationale: UART telemetry has no initiating user request, and separating it keeps remote command execution data distinct from local operator activity.
  Date/Author: 2025-12-29 / Codex
- Decision: Cap stored output length and include a `truncated` flag for UI and audit clarity.
  Rationale: UART output can be large; a cap protects the database while preserving visibility when truncation occurs.
  Date/Author: 2025-12-29 / Codex

## Outcomes & Retrospective

Remote CLI execution from the dashboard is working for `remote status`, and CAN frames can be sent and received via the dashboard UI, which confirms the REMP command + CAN transport paths are alive. UART telemetry ingestion and persistence are still not validated. All UART CLI telemetry steps are now optional per user request; the rest of the plan remains active.

Plan change note: Recorded validation of dashboard command execution and CAN send/receive on 2025-12-29 while keeping UART CLI telemetry work and validation pending.
Plan change note: Marked only the REMP type 5 decoding step as optional on 2025-12-29 at user request.
Plan change note: Marked the bridge agent UDP telemetry forwarding step as optional on 2025-12-29 at user request.
Plan change note: Marked the `cli_telemetry` database/API ingestion step as optional on 2025-12-29 at user request.
Plan change note: Marked the `cli_telemetry` SSE/UI and validation steps as optional on 2025-12-29 at user request.

## Context and Orientation

The bridge agent currently maintains control and data-plane WebSockets to the API in `dashboard/apps/bridge-agent/src/ws`. UDP REMP handling exists for pairing in `dashboard/apps/bridge-agent/src/remp`. Console events are emitted by the API via `dashboard/apps/dashboard-api/src/services/streams.ts` and streamed to the UI through SSE endpoints in `dashboard/apps/dashboard-api/src/routes/streams.ts`. The console UI is implemented in `dashboard/apps/dashboard-web/src/pages/ConsolePage.tsx` and renders events based on types defined in `dashboard/packages/shared/src/events/console.ts`.

REMP binary payloads are defined in `dashboard/packages/remp/src`. A new UART CLI telemetry payload (REMP type 5) must be decoded there so the agent can forward it to the API. The API should persist these events and publish them to the console stream for the owning user.

## Plan of Work

Extend `dashboard/packages/remp/src` with a decoder for REMP type 5 UART CLI telemetry. The decoder should parse the REMP header, verify the message type, and return `{ deviceId, corrId, command, output, truncated, exitCode }`. Use the payload layout defined in `remote-obd2-firmware-h753/Doc/remote_access.md`.

In the bridge agent, add UART CLI telemetry handling in the UDP transport module used for REMP traffic (the same socket used for pairing/CAN). When a telemetry packet is received, emit a control message to the API with a new type such as `cli_telemetry`, including `device_id`, `command`, `output`, `truncated`, `exit_code`, and a timestamp. The agent should not attempt to map device ids to dongle UUIDs; the API should resolve the device id to the dongle record.

In the API, add a new Prisma model `CliTelemetry` (or `cli_telemetry` table) with fields: `id`, `dongle_id`, `owner_user_id` (nullable), `source`, `command`, `output`, `truncated`, `created_at`. Create a service in `dashboard/apps/dashboard-api/src/services/cli-telemetry.ts` that inserts new records, caps output length, and publishes a `cli_telemetry` SSE event on `dongle:<id>`. Update `dashboard/apps/dashboard-api/src/ws/control.ts` to accept the new `cli_telemetry` control message and call the service.

Update shared types in `dashboard/packages/shared/src/events/console.ts` to include a `CliTelemetryEvent` with fields `{ dongle_id, source, command, output, truncated, ts }`. Update `dashboard/apps/dashboard-web/src/pages/ConsolePage.tsx` to render `cli_telemetry` events distinctly from `command_status`, and include them in the event filter controls if desired.

Document the telemetry flow and schema in `dashboard/Doc/new-dashboard-spec-v0.7.md`, including the database table and SSE event type. Keep the spec aligned with the firmware payload layout.

## Concrete Steps

All commands run from `E:\Projets\STM32\workspace\dashboard`.

After implementing, apply migrations and run:

  npm run dev:stack
  npm run dev:desktop --workspace apps/bridge-agent

## Validation and Acceptance

Pair a dongle and keep the agent running. Execute `net status` on the UART console. Confirm:

1) The agent logs a decoded REMP type 5 telemetry packet.
2) The API stores a `cli_telemetry` record tied to the dongle.
3) The dashboard console shows a `cli_telemetry` event with the command line and output text.
4) If output exceeds the configured cap, the UI shows `truncated=true`.

Acceptance is met when UART commands appear in the UI and can be queried in the database for the owning user.

## Idempotence and Recovery

Telemetry ingestion is additive and safe to retry. If the API cannot resolve a device id, it should drop the event with a log entry rather than failing the control channel. Restarting the agent should rebind the UDP socket and resume telemetry without additional configuration.

## Artifacts and Notes

Capture a sample agent log showing a decoded telemetry packet and a console SSE event showing the same command and output.

## Interfaces and Dependencies

In `dashboard/packages/remp/src`, add:

  export type CliTelemetry = { deviceId: string; corrId: string; command: string; output: string; truncated: boolean; exitCode: number };
  export const decodeCliTelemetry(buffer: Buffer): CliTelemetry | null;

In `dashboard/apps/bridge-agent/src/ws/control.ts`, send a message to the API:

  type: "cli_telemetry"
  device_id: string
  command: string
  output: string
  truncated: boolean
  exit_code: number
  ts: string

Plan change note: 2026-01-02 - Recorded that remote CLI execution works as a baseline before UART telemetry validation.
