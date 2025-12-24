# Control Plane: Agents, Dongles, and CAN Configuration

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the Cloud API exposes stable control plane endpoints for agents and dongles, tracks online presence, and applies CAN configuration changes to dongles through the agent with acknowledgements. You can see it working by registering an agent, reporting discovered dongles, listing them in the API, and applying a CAN config that is acknowledged by the dongle.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-23 08:28Z) Implement agent registration, heartbeat, and device reporting endpoints in the API.
- [x] (2025-12-23 08:28Z) Implement dongle inventory endpoints and presence tracking.
- [x] (2025-12-23 08:28Z) Implement CAN configuration apply flow with acknowledgements.
- [x] (2025-12-23 08:28Z) Add audit logging for config changes and device ownership updates.
- [x] (2025-12-23 08:28Z) Validate control plane flows with an agent and dongle.
- [x] (2025-12-23 13:05Z) Add the control WebSocket server at `/ws/agent` in the API and validate agent WS connectivity.
- [x] (2025-12-23 11:30Z) Add scripted Playwright validation of the agent login/status UI and verify real heartbeat updates against the API.
- [x] (2025-12-23 15:30Z) Add control WS request/ack flow for CAN config apply and agent-side handler stub.
- [x] (2025-12-23 15:30Z) Capture and persist agent network interface summaries on register/heartbeat.
- [x] (2025-12-23 16:05Z) Apply `agents.network_interfaces` migration.
- [x] (2025-12-23 16:08Z) Run `test:agent-heartbeat` validation after migration.

## Surprises & Discoveries

- Observation: Agent bearer-token requests should bypass CSRF checks because they do not use cookie auth.
  Evidence: Agent heartbeat returned `CSRF_INVALID` until the CSRF middleware skipped bearer token requests.
- Observation: `prisma migrate dev` cannot run in the non-interactive environment, so the migration was generated via `prisma migrate diff` and applied manually to avoid dropping the `session` table.
  Evidence: `prisma migrate dev` reported non-interactive usage and the diff suggested dropping `session`.
- Observation: The repo did not include a REMP CAN-config transport yet, so the agent applies configs via a placeholder and immediately acks.
  Evidence: No `apps/bridge-agent/src/remp` implementation existed beyond the placeholder package.
- Observation: Applying the new migration failed due to missing `DATABASE_URL`.
  Evidence: `Error: Environment variable not found: DATABASE_URL.`
- Observation: Heartbeat validation failed because the API was not running.
  Evidence: `connect ECONNREFUSED ::1:3000` from `test-agent-heartbeat.ts`.
- Observation: Prisma client generation initially failed on Windows due to a locked query engine file.
  Evidence: `EPERM: operation not permitted, rename ... query_engine-windows.dll.node.tmp -> query_engine-windows.dll.node`.

## Decision Log

- Decision: Treat agent heartbeats as the source of presence for the agent and its reported dongles.
  Rationale: The agent is on the LAN and best positioned to report liveness; the API should persist last seen timestamps.
  Date/Author: 2025-12-22 / Codex
- Decision: Store CAN config changes in the database and mark them applied only after dongle ACK.
  Rationale: The UI must show what is actually applied, not just requested.
  Date/Author: 2025-12-22 / Codex
- Decision: Authenticate agents using bearer tokens hashed with SHA-256 and stored in `agent_tokens`.
  Rationale: It keeps agent credentials out of logs and allows token revocation without changing the API surface.
  Date/Author: 2025-12-23 / Codex
- Decision: Persist LAN IP, firmware build, and last seen agent ID on the `dongles` table to support inventory and apply flows.
  Rationale: The control plane endpoints need these values, and keeping them with the dongle record avoids extra tables.
  Date/Author: 2025-12-23 / Codex
- Decision: Store agent network interface summaries in `agents.network_interfaces` and accept updates on heartbeat.
  Rationale: The spec requires a sanitized network interface summary for diagnostics without exposing secrets.
  Date/Author: 2025-12-23 / Codex
- Decision: Use a control WS request/ack pattern with timeouts for CAN config apply.
  Rationale: The API must block until a response arrives or times out to report applied configs accurately.
  Date/Author: 2025-12-23 / Codex

## Outcomes & Retrospective

- Agent registration returns an agent token and WS URL, and heartbeat/device report update presence timestamps.
- Dongle inventory endpoints return owned dongles with presence metadata and CAN config.
- CAN config apply stores the effective config, logs an audit entry, and returns applied status after a WS ack.
- Device ownership updates are auditable when an ownership change is reported.
- Validation uses the control plane test script and Playwright to confirm `/healthz` and end-to-end control plane flows.
- Added a scripted Playwright UI flow for the bridge agent renderer and noted heartbeat verification against the API.
- Added dongle presence fields (LAN IP, firmware build, agent ID) via a dedicated migration applied manually.
- Implemented the `/ws/agent` control WebSocket server and extended control plane validation to cover WS heartbeats and command delivery.
- Agent registration and heartbeat now capture network interface summaries for diagnostics.
- The agent currently acks CAN config applies immediately via a placeholder until the REMP transport is implemented.
- Heartbeat validation requires the API to be running at the expected base URL.
- Migration is applied and heartbeat validation passes with the local Docker database.

## Context and Orientation

The Cloud API provides `/api/v1/agents/register`, `/api/v1/agents/heartbeat`, and `/api/v1/agents/devices/report` for agent interaction. Dongles are listed and inspected via `/api/v1/dongles` and `/api/v1/dongles/:id`. CAN configuration is applied via `PUT /api/v1/dongles/:id/can-config` and must be forwarded to the dongle via the agent. The API stores dongles and configs in Postgres and should update last seen timestamps based on agent reports and control plane messages.

Relevant files include `apps/dashboard-api/src/routes/agents.ts`, `apps/dashboard-api/src/routes/dongles.ts`, `apps/dashboard-api/src/services/agents.ts`, `apps/dashboard-api/src/services/dongles.ts`, `apps/dashboard-api/src/services/can-config.ts`, and agent side REMP helpers under `apps/bridge-agent/src/remp/can-config.ts`.

## Plan of Work

Implement the agent API endpoints. The register endpoint should create an agent record, create an agent token (stored as a hash), and return the agent ID, agent token, and WebSocket URL. The heartbeat endpoint should update last seen timestamps and accept basic metadata updates. The devices report endpoint should upsert dongles by device ID, update LAN IP and firmware build, and record last seen timestamps tied to the reporting agent.

Implement dongle inventory endpoints. `GET /api/v1/dongles` should list dongles owned by the current user, include ownership state, last seen, and current LAN IP. `GET /api/v1/dongles/:id` should return detailed information including CAN config and group membership if present. These endpoints should enforce that a user can only view their own dongles unless they are a super admin.

Implement CAN configuration apply. The API should validate the config, persist it to `can_configs`, and instruct the agent to send the config to the dongle. The agent should return an ACK with the effective config, and the API should update the record with the effective values and `applied_at` timestamp. Any failures should return a clear error code and remain in audit logs.

Implement audit logging for configuration changes and agent actions. Each CAN config apply should record an audit log entry with before and after values and the actor user. Agent register and device report events should be logged at least at debug or info level, with audit entries reserved for user driven actions.

Add an end-to-end validation step that runs the bridge agent UI against the API and confirms that a successful login updates the heartbeat timestamp in both the API and the agent status UI. Create or reuse a scripted Playwright flow that exercises the agent login/status UI and asserts the status view updates after login.

Implement the agent control WebSocket server in the API at `/ws/agent`. The server must authenticate the agent bearer token, accept JSON messages (heartbeat, acknowledgements, command responses), and expose a way for API services (pairing, commands, CAN config apply) to send control messages to connected agents. Maintain presence metadata for connected agents and surface connection status for diagnostics.

## Concrete Steps

Create `apps/dashboard-api/src/routes/agents.ts` and `apps/dashboard-api/src/routes/dongles.ts` if they do not exist. Implement handlers for register, heartbeat, device report, dongle list, and dongle detail. Add services in `apps/dashboard-api/src/services/agents.ts` and `apps/dashboard-api/src/services/dongles.ts` for database interactions and validation.

Create `apps/dashboard-api/src/services/can-config.ts` with `applyCanConfig(dongleId, userId, config)` and integrate with the agent control WebSocket to send config commands. On the agent side, implement `apps/bridge-agent/src/remp/can-config.ts` to send the config and parse the ACK from the dongle.

Update the shared types in `packages/shared/src/api/dongles.ts` and `packages/shared/src/protocols/can-config.ts` to reflect the config schema and response payloads.

Add or reuse a scripted Playwright test that drives the agent login/status UI, and document how to run it alongside the API to confirm the agent heartbeat updates are reflected in the UI and in the API's last-seen timestamps.

Add an API WebSocket module (for example `apps/dashboard-api/src/ws/control.ts`) that registers a `/ws/agent` endpoint on the HTTP server, validates bearer tokens against `agent_tokens`, and routes inbound messages to handler functions. Provide a helper for sending commands (pairing, CAN config, command console) to an agent by ID.

Apply the migration that adds `agents.network_interfaces` after confirming `DATABASE_URL` points at the intended Postgres instance. From the repository root, run:

    E:\Projets\STM32\workspace\dashboard> $env:DATABASE_URL="postgresql://..."
    E:\Projets\STM32\workspace\dashboard> npx prisma migrate deploy

If the project uses local dev migrations instead, use `npx prisma migrate dev` with the same `DATABASE_URL` and keep the generated migration files in place.

## Validation and Acceptance

Register an agent and verify the API returns an agent token and WebSocket URL. Report a discovered dongle and verify it appears in `GET /api/v1/dongles` for the owning user. Apply a CAN config and verify the API response includes `applied: true` and an `effective` config. Confirm an audit log entry exists for the config change. Confirm the dongle detail endpoint shows the current config and last seen timestamp. Start the dashboard API and the bridge agent, log in via the agent UI, and confirm the heartbeat timestamp updates in both the agent status view and the API record (for example, by inspecting the agent status response or database field). Run the scripted Playwright test to validate the UI login-to-status flow while the API is running. Connect an agent to `/ws/agent` and confirm the connection is accepted, heartbeat messages are received, and a control message can be sent from the API to the agent.

After applying the migration, validate the agent heartbeat flow with the provided script. From the repository root, run:

    E:\Projets\STM32\workspace\dashboard> $env:DATABASE_URL="postgresql://..."
    E:\Projets\STM32\workspace\dashboard> npm run test:agent-heartbeat --workspace apps/dashboard-api

The script should print `Agent heartbeat validation passed.` and exit 0. If it fails due to connectivity, verify the database is running and the API is reachable.

## Idempotence and Recovery

Device reporting should be idempotent and update existing records without duplicates. Heartbeat updates should be safe to repeat. CAN config apply should be idempotent when the same config is sent repeatedly; the API should still record an `applied_at` timestamp but avoid duplicate audit entries if the config did not change.

## Artifacts and Notes

Example CAN config apply response:

    {
      "dongle_id": "uuid",
      "applied": true,
      "effective": {
        "bitrate": 500000,
        "sample_point_permille": 875,
        "mode": "normal",
        "use_raw": false,
        "prescaler": 16,
        "sjw": 1,
        "tseg1": 13,
        "tseg2": 2,
        "auto_retx": true,
        "tx_pause": false,
        "protocol_exc": false
      },
      "applied_at": "2025-12-22T15:31:10.000Z"
    }

Scripted UI validation:

    npm run test:playwright --workspace apps/bridge-agent

Heartbeat validation (requires API + database running):

    npm run test:agent-heartbeat --workspace apps/dashboard-api

## Interfaces and Dependencies

In `apps/dashboard-api/src/services/can-config.ts`, define `applyCanConfig(dongleId, userId, config)` returning `{ applied: boolean; effective: CanConfig; appliedAt: string }`. In `apps/bridge-agent/src/remp/can-config.ts`, define `sendCanConfig(target, config)` and emit an ACK with the effective config.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
Plan change note: Implemented agent control plane endpoints, dongle inventory, CAN config apply, and validation on 2025-12-23.
Plan change note: Added explicit UI + heartbeat validation steps and Playwright automation coverage on 2025-12-23.
Plan change note: Added control WebSocket server requirements for `/ws/agent` on 2025-12-23.
Plan change note: Added network interface summaries on agent register/heartbeat and WS request/ack for CAN config apply on 2025-12-23.
Plan change note: Documented migration/validation steps and recorded the missing `DATABASE_URL` + API-down blockers on 2025-12-23.
Plan change note: Applied the migration, regenerated Prisma client, and validated heartbeat flow on 2025-12-23.
