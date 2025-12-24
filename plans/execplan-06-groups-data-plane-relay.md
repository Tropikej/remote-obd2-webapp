# Dongle Groups and Data Plane Relay

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, users can create two dongle groups, activate and deactivate them, and the system relays CAN frames between the two dongles via the Cloud API using Redis Streams as a buffer. When one side is offline, frames are buffered and replayed on reconnect, and the UI receives clear degraded state updates. You can see it working by activating a group, sending CAN frames from one dongle, disconnecting the other, and then reconnecting to see buffered frames replayed in order.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-23 20:45Z) Implement group CRUD endpoints with ownership validation.
- [x] (2025-12-23 20:48Z) Add data plane WebSocket channel between agent and API with Redis-backed buffering.
- [x] (2025-12-23 20:50Z) Implement replay and degraded/active mode updates driven by agent connection state.
- [x] (2025-12-23 20:52Z) Validate ordering and offline behavior with a simulated two-agent relay test (`npm run test:data-plane`).
- [ ] Validate relay and buffering with real dongles/firmware over UDP REMP CAN frames (hardware pending).
- [ ] Document and validate Redis deployment parity (dev Docker vs. VPS/managed Redis), including `REDIS_URL` env and health checks.

## Surprises & Discoveries

- Observation: Local environments lacked Redis; using an in-memory `ioredis-mock` fallback keeps tests runnable without external services but should be replaced with real Redis in production.
  Evidence: `apps/dashboard-api/src/redis/client.ts` warns and falls back when `REDIS_URL` is unset; tests still pass.
- Observation: Group creation in tests required setting dongle ownership directly because pairing is not wired into the relay test flow.
  Evidence: `infra/scripts/test-data-plane.js` updates dongles via Prisma before creating the group.
- Observation: Data-plane currently relays JSON CAN frames over WebSocket; UDP/REMP CAN transport to/from dongles remains to be integrated.
  Evidence: `apps/bridge-agent/src/ws/data-plane.ts` only handles WS frames; no REMP CAN handler exists yet.

## Decision Log

- Decision: Use Redis Streams as the single buffering mechanism with one stream per group direction.
  Rationale: The spec mandates Redis Streams and the per direction stream aligns with ordering guarantees.
  Date/Author: 2025-12-22 / Codex
- Decision: Track group mode transitions in the database and emit SSE events on changes.
  Rationale: The UI must show degraded state and buffering levels, so persistent state and events keep it consistent.
  Date/Author: 2025-12-22 / Codex
- Decision: Allow an in-memory Redis mock in dev/test when `REDIS_URL` is unset to keep automated relay tests runnable without external dependencies.
  Rationale: CI/local machines may not have Redis; the mock preserves behavior for tests while production still uses real Redis when configured.
  Date/Author: 2025-12-23 / Codex
- Decision: Apply group mode updates based on agent data-plane connections (ACTIVE when both sides connected, DEGRADED otherwise) and trim buffered streams on replay.
  Rationale: Keeps mode/state in sync with connectivity while ensuring buffered frames drain deterministically on reconnect.
  Date/Author: 2025-12-23 / Codex
- Decision: Use JSON CAN frame envelopes over the data-plane WebSocket; defer UDP/REMP CAN integration to a follow-up once firmware hooks are available.
  Rationale: Enables end-to-end relay and buffering tests today while acknowledging that binary REMP alignment requires firmware work.
  Date/Author: 2025-12-23 / Codex

## Outcomes & Retrospective

- Group CRUD (list/create/activate/deactivate) now exists under `/api/v1/groups`, enforcing ownership and uniqueness.
- Data-plane WebSocket at `/ws/data` authenticates agents, forwards CAN frames between agents for active groups, buffers per-direction streams in Redis when the target is offline, and replays on reconnect while updating group mode to DEGRADED/ACTIVE.
- Bridge agent exposes a data-plane client that connects to `/ws/data`; CAN frames are forwarded over WS (UDP/REMP CAN still TODO).
- Added relay integration test `npm run test:data-plane` that spins up two agents, buffers a frame while one agent is offline, replays on reconnect, and asserts group mode transitions.
- Local dev/test can run without Redis via `ioredis-mock`; production should set `REDIS_URL` for durable buffering.

## Context and Orientation

Groups are defined in the database as pairs of dongles that belong to the same user. The Cloud API exposes `/api/v1/groups` endpoints for listing, creating, activating, and deactivating groups. The data plane is a WebSocket channel between each agent and the API that carries CAN frames for active groups. The API relays frames between agents and buffers them using Redis Streams when one side is offline. The agent sends and receives CAN frames over UDP REMP to the dongles.

Relevant files include `apps/dashboard-api/src/routes/groups.ts`, `apps/dashboard-api/src/services/groups.ts`, `apps/dashboard-api/src/ws/data-plane.ts`, `apps/bridge-agent/src/ws/data-plane.ts`, and a Redis helper in `apps/dashboard-api/src/redis/client.ts`.

## Plan of Work

Implement group creation and validation in the API. Verify both dongles exist, are owned by the requesting user, and are not already in a group. Create the group record with mode `inactive`. Implement activate and deactivate endpoints that switch the mode and notify agents via the control plane. When activating, the API must record the intended relay pairing between the two dongles and allow the data plane to route frames.

Implement a dedicated data plane WebSocket path such as `/ws/data` that the agent connects to using its agent token. The data plane should accept CAN frames tagged with group ID and direction, and it should forward them to the opposite agent if connected. When the target agent is offline, the API must append the frame to the corresponding Redis Stream.

Implement Redis Streams per direction using keys `group:{group_id}:a_to_b` and `group:{group_id}:b_to_a`. Enforce retention based on both time and max length. When retention limits are hit, trim oldest entries and emit a buffer pressure event and audit log entry. Track per group backlog counts and expose them to the UI via SSE and group state.

Implement replay behavior. When an agent reconnects, the API should replay buffered frames in order until the backlog is empty, then switch to live forwarding. Replay should be rate limited to prevent starving live traffic, for example by capping frames per second and interleaving live frames.

Implement degraded state logic. If one side is offline, the group mode should switch to `degraded`. When both sides are online again and backlog drains, switch to `active`. Persist these mode changes in the database and emit `group_state` events to SSE clients.

Document Redis setup for both development and deployment. Provide a local one-liner (`docker run -p 6379:6379 redis:7`) and note that staging/prod must run a real Redis (system service or managed) with `REDIS_URL` set alongside `DATABASE_URL` in the API env. Keep the in-memory mock only for fast local/unit tests; require running against real Redis (set `REDIS_URL`) for pre-deploy validation.

## Concrete Steps

Add group routes in `apps/dashboard-api/src/routes/groups.ts` and connect them to `apps/dashboard-api/src/services/groups.ts` with validation and ownership checks. Add a Redis client module if not present and configure it via environment variables.

Create a data plane WebSocket handler in `apps/dashboard-api/src/ws/data-plane.ts` that authenticates agents, subscribes them to their active group streams, and routes CAN frame messages. Define a message schema in `packages/shared/src/protocols/can-relay.ts` with fields for group ID, dongle ID, direction, and frame payload.

In the agent, create `apps/bridge-agent/src/ws/data-plane.ts` to maintain a WebSocket connection for CAN relay. Implement sending of CAN frames received from the dongle and writing inbound frames to the dongle via UDP REMP.

Implement Redis Stream functions for append, trim, read from last ID, and replay. Integrate these into the data plane handler.

Add Redis setup notes and commands:
- Local dev: `docker run -p 6379:6379 redis:7` and export `REDIS_URL=redis://localhost:6379`.
- VPS/managed: install/enable Redis or provision managed Redis; set `REDIS_URL` in `/etc/obd2-dashboard.env`.
- Health: extend `/healthz`/`/readyz` (ExecPlan-10) to fail when Redis is unreachable.
Ensure `npm run test:data-plane` can target real Redis by setting `REDIS_URL` to match production-like conditions.

## Validation and Acceptance

Start Redis, the API, and two agents connected to different dongles. Create a group and activate it. Send CAN frames from dongle A and confirm they arrive at dongle B. Disconnect the agent for dongle B and send frames from A; confirm the group moves to `degraded` and buffered frame counts increase. Reconnect agent B and confirm buffered frames replay in order and the group returns to `active`. Verify that if the backlog exceeds the retention limits, the system logs buffer pressure and trims old frames.

## Idempotence and Recovery

Group creation should fail cleanly if the group already exists. Activation and deactivation are idempotent and should return the current group state when called repeatedly. Redis stream operations should tolerate reconnects, and replay should resume from the last acknowledged ID. If the data plane connection drops, the agent should reconnect and replay should continue from the last stored state.

## Artifacts and Notes

Example Redis stream keys:

    group:uuid:a_to_b
    group:uuid:b_to_a

## Interfaces and Dependencies

In `packages/shared/src/protocols/can-relay.ts`, define a `CanRelayFrame` type with `groupId`, `direction`, `ts`, `canId`, `isExtended`, `dlc`, and `dataHex`. The agent and API must use this type when sending on the data plane WebSocket.

In `apps/dashboard-api/src/ws/data-plane.ts`, define a `handleDataPlaneConnection(ws, agent)` function that routes frames and writes to Redis Streams.

In `apps/bridge-agent/src/ws/data-plane.ts`, define `connectDataPlaneWs({ agentId, token, apiUrl })` and emit events for inbound frames.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
