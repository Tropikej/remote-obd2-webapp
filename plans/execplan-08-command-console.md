# Command Console End to End

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, users can send allowlisted commands to a dongle through the dashboard, receive command status and output, and see results streamed back in the UI. The system enforces timeouts, permissions, and audit logging. You can see it working by submitting a command, seeing it transition from queued to running to done, and receiving stdout and stderr output in the console.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-24 15:27Z) Implement command API endpoints and database persistence.
- [x] (2025-12-24 15:27Z) Implement command allowlist and permission checks.
- [x] (2025-12-24 15:27Z) Implement agent REMP CMD_REQ and CMD_RSP handling with correlation IDs.
- [x] (2025-12-24 15:27Z) Stream command status updates to SSE and verify output handling.
- [x] (2025-12-24 15:27Z) Validate timeouts, error cases, and audit logging.

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Persist command records in the `commands` table and treat the database as the source of truth for status.
  Rationale: The UI needs stable status views and auditability; persistence ensures recovery after restarts.
  Date/Author: 2025-12-22 / Codex
- Decision: Use correlation IDs from the API as the REMP `corr_id`.
  Rationale: It simplifies mapping responses to command records and aligns with the spec.
  Date/Author: 2025-12-22 / Codex

## Outcomes & Retrospective

Command console is now end-to-end: users enqueue allowlisted commands via `/api/v1/dongles/:id/commands`, commands persist in the database with ownership checks, dispatch to the last seen agent over the control WS, and enforce timeouts with server-side fallbacks. Agent responses (including chunks) update command records and stream `command_status` events to SSE with stdout/stderr, exit code, and timestamps. Audit logs capture enqueue metadata (command, args, timeout, actor IP/UA). Allowlist defaults cover `ifconfig`, `ip`, and `ping` with sane arg and timeout caps. Vitest covers validation, dispatch, status updates, and timeout behavior. **TODO:** run end-to-end with a real agent/dongle to validate control WS payloads and streamed outputs once hardware is available.

## Context and Orientation

Command console requests are initiated by the UI through `POST /api/v1/dongles/:id/commands`, and status is retrieved by `GET /api/v1/dongles/:id/commands/:command_id`. The agent sends `CMD_REQ` over UDP REMP and receives `CMD_RSP` responses, possibly chunked. The API must allow only allowlisted commands, enforce timeouts, and log all invocations in the audit log. Status updates are emitted to SSE under the dongle console stream.

Relevant files include `apps/dashboard-api/src/routes/commands.ts`, `apps/dashboard-api/src/services/commands.ts`, `apps/bridge-agent/src/remp/commands.ts`, and `packages/shared/src/protocols/commands.ts`.

## Plan of Work

Implement the API endpoints to create and read command records. On create, validate ownership, validate the command against an allowlist, create a `commands` record with status `queued`, and send a command request to the agent via the control WebSocket. Return a `command_id` immediately. The agent should then send `CMD_REQ` to the dongle with the correlation ID equal to the command ID.

Implement command status updates. When the agent receives `CMD_RSP` or `CMD_RSP_CHUNK`, forward it to the API, which updates the command record to `running` or `done` based on response content. For chunked output, append stdout and stderr in order. For timeouts, set status `timeout` and record an error. Emit `command_status` SSE events so the UI updates in real time.

Implement allowlisting and permissions. The allowlist should be defined in a config module with explicit command names, optional argument constraints, and timeouts. Permission checks should ensure only owners or super admins can execute commands. All command executions and failures should create audit log entries with actor, dongle, command, and outcome.

## Concrete Steps

Create `apps/dashboard-api/src/services/commands.ts` with functions `enqueueCommand(dongleId, userId, command, args, timeoutMs)` and `updateCommandFromAgent(corrId, payload)`. Create `apps/dashboard-api/src/routes/commands.ts` and wire it under the dongle routes.

Add `packages/shared/src/protocols/commands.ts` defining the `CMD_REQ`, `CMD_RSP`, and optional `CMD_RSP_CHUNK` shapes and a typed mapping between API command IDs and REMP correlation IDs.

Implement `apps/bridge-agent/src/remp/commands.ts` to send `CMD_REQ` and receive responses. The agent should forward responses to the API via the control WebSocket and include the correlation ID.

Update SSE publishing in the streaming plan so command status updates are emitted as `command_status` events on the dongle console stream.

## Validation and Acceptance

Start the API and agent, then submit a command from the UI or curl. Confirm the API returns a command ID and status `queued`. Observe a `command_status` event with status `running`, then `done` with stdout and stderr output. Submit a disallowed command and verify it fails with `VALIDATION_ERROR` or a command specific error code and is audited. Force a timeout by setting a low timeout value and verify status becomes `timeout`.

## Idempotence and Recovery

Creating a command always creates a new record and is not idempotent. If the agent reconnects after a failure, it should not resend completed commands unless explicitly instructed. Command status updates should be safe to re apply, with the API ignoring out of order updates once a command is in a terminal state.

## Artifacts and Notes

Example command request payload:

    {
      "command": "ifconfig",
      "args": [],
      "timeout_ms": 5000
    }

## Interfaces and Dependencies

In `apps/dashboard-api/src/services/commands.ts`, define:

    function enqueueCommand(dongleId: string, userId: string, command: string, args: string[], timeoutMs: number): Promise<Command>;
    function updateCommandFromAgent(corrId: string, payload: CmdResponsePayload): Promise<void>;

In `apps/bridge-agent/src/remp/commands.ts`, define `sendCommand(target, command, args, timeoutMs, corrId)` and an event emitter that yields `CmdResponsePayload` for the control plane to forward.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
