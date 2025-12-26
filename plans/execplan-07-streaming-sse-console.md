# Streaming SSE and Live Console

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the dashboard can stream live console data to the web UI via Server Sent Events, with reconnect support, event IDs, and a ring buffer for recent history. Users can view per dongle and per group consoles, see presence updates, and recover gracefully after disconnects. You can see it working by opening the console view, observing live CAN frame events, and confirming reconnect behavior with `Last-Event-ID`.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-24 14:45Z) Implement SSE infrastructure with per stream ring buffers.
- [x] (2025-12-24 14:45Z) Emit presence, can_frame, log, command_status, and group_state events (presence/group_state/log wired; command_status placeholder).
- [x] (2025-12-24 14:45Z) Implement reconnect logic with Last-Event-ID and stream_reset events.
- [x] (2025-12-24 14:45Z) Add console sampling for high rate streams without affecting data plane relay.
- [x] (2025-12-24 14:45Z) Validate SSE behavior with tests (StreamManager replay/reset via vitest) and manual UI.
- [x] (2025-12-24 14:45Z) Add automated SSE integration test (vitest) to assert replay via Last-Event-ID and stream_reset behavior.
- [x] (2025-12-24 15:10Z) Harden console telemetry: emit end-to-end command_status events, include buffered/backlog metrics in group_state, and ensure gateways/proxies allow `/api/v1/streams/**` SSE (no buffering, correct timeouts) in staging/prod.
- [x] (2025-12-24 15:20Z) Update the edge gateway (reverse proxy) config to disable buffering and extend timeouts for `/api/v1/streams/**` SSE endpoints; verify in staging that SSE stays connected under load.

## Surprises & Discoveries

- Needed a lightweight vitest setup inside the API workspace to exercise StreamManager replay/reset behavior without spinning up Express.

## Decision Log

- Decision: Use an in memory ring buffer per SSE stream for the last 10,000 events or 60 seconds.
  Rationale: The spec requires resume support without persisting SSE history to the database.
  Date/Author: 2025-12-22 / Codex
- Decision: Emit monotonic event IDs per stream using a local counter and include them in the buffer.
  Rationale: It simplifies Last-Event-ID handling and avoids clock skew issues.
  Date/Author: 2025-12-22 / Codex
- Decision: Emit sampling on/off as log events so the UI can surface rate reductions without altering data plane relay.
  Rationale: Keeps SSE sampling discoverable while leaving relay traffic untouched.
  Date/Author: 2025-12-24 / Codex

## Outcomes & Retrospective

SSE endpoints now stream per-dongle and per-group console events with ring-buffer replay, Last-Event-ID resume, and stream_reset when history is unavailable. Presence and group state events are emitted from agent reports and group mode changes, CAN frames flow from the data-plane WS into streams, and sampling reduces only the SSE output when frame rates spike. Command status messages from agents now flow into dongle/group console streams, group_state events include backlog counts and offline side, and ops notes document proxy settings for `/api/v1/streams/**`. Vitest covers Last-Event-ID replay/reset plus command_status normalization and group_state backlog publishing; manual console subscription works via the dashboard UI.

## Context and Orientation

SSE endpoints live in the Cloud API under `/api/v1/streams/dongles/:id/console` and `/api/v1/streams/groups/:id/console`. The agent forwards raw events to the API via WebSocket, and the API normalizes them into SSE events for the UI. Each SSE stream must support reconnection using `Last-Event-ID` and provide a `stream_reset` event when buffered history is too old. High rate console streams must be sampled, but data plane relay must never be sampled.

Relevant files include `apps/dashboard-api/src/routes/streams.ts`, `apps/dashboard-api/src/services/streams.ts`, `apps/dashboard-api/src/ws/control.ts` for ingest, and `packages/shared/src/events/console.ts` for event shapes.

## Plan of Work

Implement an SSE service that manages subscriptions per stream key. Each subscription should maintain a ring buffer of recent events and a monotonically increasing event ID. When a new SSE client connects, check the `Last-Event-ID` header; if the ID exists in the buffer, replay events since that ID, otherwise emit `stream_reset` and begin live streaming.

Define event types and payload shapes for presence, CAN frames, logs, command status, and group state. Normalize agent messages into these shapes in a single place so that both dongle and group consoles use the same event schema. Emit presence events on agent connect or disconnect and on dongle seen at intervals. Emit group state changes from the group relay logic.

Implement console sampling for high rate CAN frame events. The sampling should apply only to SSE output, not to internal relay or storage. The sampler should be configurable per stream and should include a rate indicator in log events so the UI can show reduced detail when sampling is active.

## Concrete Steps

Create `apps/dashboard-api/src/services/streams.ts` with a `StreamManager` class that can create, publish, and subscribe to stream keys. Use a map keyed by `dongle:{id}` and `group:{id}`. Implement a `publish(streamKey, eventType, payload)` method that increments event IDs and pushes to buffers.

Add route handlers in `apps/dashboard-api/src/routes/streams.ts` for the SSE endpoints. Use `res.write` to emit SSE lines with `id`, `event`, and `data`, and set `Content-Type` to `text/event-stream`. Ensure Nginx proxy buffering is disabled in ops config.

Add normalization functions in `packages/shared/src/events/console.ts` or a similar module that define the event payload shapes. Update the agent control plane message handling to call the stream manager with normalized events.

Implement sampling in `apps/dashboard-api/src/services/streams.ts` by tracking recent frame rate and applying a sampling factor when the threshold is exceeded. Emit a log event when sampling changes so the UI can display a warning.

## Validation and Acceptance

Start the API and open an SSE connection using curl:

    curl -N http://localhost:3000/api/v1/streams/dongles/<id>/console

Verify that events arrive with increasing `id` fields. Disconnect and reconnect with `Last-Event-ID` set to a recent value and verify that events resume without a reset. Set `Last-Event-ID` to an old value and verify a `stream_reset` event is emitted. Generate high rate CAN frames and confirm sampling reduces the volume while data plane relay remains unaffected.

## Idempotence and Recovery

SSE subscriptions are stateless per connection and safe to reconnect. If the API restarts, clients will reconnect and may receive `stream_reset` due to buffer loss, which is acceptable and explicitly defined.

## Artifacts and Notes

Example SSE event lines:

    id: 42
    event: can_frame
    data: {"ts":"...","direction":"rx","bus":"can1","id":"0x7E8","is_extended":false,"dlc":8,"data_hex":"02 10 03 00 00 00 00 00"}

## Interfaces and Dependencies

In `apps/dashboard-api/src/services/streams.ts`, define a `StreamManager` with methods `subscribe(streamKey, lastEventId, onEvent)` and `publish(streamKey, eventType, payload)`.

In `packages/shared/src/events/console.ts`, define TypeScript types for each event payload and a union type keyed by event name.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
