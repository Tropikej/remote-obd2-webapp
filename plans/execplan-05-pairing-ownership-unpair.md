# Pairing, Ownership, and Unpairing Flow

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, a user can pair a dongle using a PIN, the system enforces pairing timeouts and security hold rules, ownership is stored in the database, and unpairing clears tokens and groups with a full audit trail. You can see it working by discovering a dongle, entering pairing mode, submitting a PIN, observing the dongle become owned by the user, and then unpairing it successfully.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-23 16:20Z) Implement pairing state machine and session records in the API.
- [x] (2025-12-23 16:20Z) Implement agent commands for pairing mode start and submit (stubbed).
- [x] (2025-12-23 16:20Z) Enforce PIN attempt limits, cooldown, and security hold triggers.
- [x] (2025-12-23 16:20Z) Implement unpair and admin force unpair with audit logs.
- [x] (2025-12-23 17:00Z) Implement real UDP pairing transport in the bridge agent and surface results to the API (JSON over UDP; REMP framing still to align with firmware).
- [x] (2025-12-23 17:02Z) Validate pairing transport via simulator script (success/invalid-pin).
- [ ] Validate pairing edge cases and race conditions with real firmware (pending REMP framing and hardware tests).
- [ ] Align pairing transport to full REMP binary framing once firmware exposes compatible messages (currently JSON shim for agent<>dongle).
- [ ] (2025-12-23 20:25Z) Add hardware-in-loop pairing validation script that exercises REMP framing against real dongles when firmware is ready.

## Surprises & Discoveries

- Observation: Prisma client generation on Windows can fail when repo-scoped Node processes hold the query engine file.
  Evidence: `EPERM: operation not permitted, rename ...query_engine-windows.dll.node.tmp -> query_engine-windows.dll.node` resolved by stopping stray Node processes.
- Observation: `tsc` build fails because `rootDir` excludes workspace packages; dev via ts-node still works.
  Evidence: `TS6059` complaining about `packages/shared` when running `npm run build --workspace apps/dashboard-api`.
- Observation: Agent pairing transport is stubbed; pairing success is simulated when PIN is `123456`, invalid otherwise.
  Evidence: Placeholder in `apps/bridge-agent/src/remp/pairing.ts`.
- Observation: Agent UDP transport currently uses JSON over UDP as a bridge until REMP framing is available; simulator covers ok/invalid_pin but firmware-level framing still needs alignment.
  Evidence: `apps/bridge-agent/src/scripts/test-pairing.ts` uses the UDP helper against a fake dongle server.
- Observation: Full REMP binary framing for pairing is still pending because current firmware only accepts the JSON shim; shifting to REMP requires firmware changes to emit/accept framed `PAIRING_MODE_START/SUBMIT`.
  Evidence: Agent pairing helper and simulator operate over JSON UDP without firmware parity.

## Decision Log

- Decision: Implement pairing sessions as first class records in the database with expiry timestamps and attempt counters.
  Rationale: It makes enforcement of TTL and PIN attempts deterministic and auditable.
  Date/Author: 2025-12-22 / Codex
- Decision: Treat `device_id` as the canonical dongle identity and link ownership by `dongles.id`.
  Rationale: The spec uses device ID for discovery and a stable UUID for DB relations, so this keeps API and DB in sync.
  Date/Author: 2025-12-22 / Codex
- Decision: Enforce a max of 5 PIN attempts per session with a 5-minute security hold, recorded on pairing sessions and reflected in `ownership_state`.
  Rationale: Matches the spec's pairing security requirements with minimal schema changes.
  Date/Author: 2025-12-23 / Codex
- Decision: Stub pairing transport in the agent; treat PIN `123456` as success and all others as `invalid_pin` until REMP integration arrives.
  Rationale: Allows end-to-end API/state-machine validation without firmware support.
  Date/Author: 2025-12-23 / Codex
- Decision: Force-unpair clears tokens, groups, and active pairing sessions while logging an audit entry for traceability.
  Rationale: Keeps unpair idempotent and auditable for both user and admin paths.
  Date/Author: 2025-12-23 / Codex
- Decision: Keep a JSON-over-UDP shim for pairing until firmware supports the REMP binary framing; track REMP alignment as a TODO in this plan.
  Rationale: The agent needs a working transport today, but matching the spec's framing requires embedded changes we do not control immediately.
  Date/Author: 2025-12-23 / Codex

## Outcomes & Retrospective

- Pairing sessions persist TTL, attempts, status, hold_until, and hold_reason; start pairing returns/creates an active session.
- PIN submit routes through control WS; success claims ownership and stores encrypted dongle tokens; invalid PIN increments attempts and triggers hold on the 5th failure.
- Unpair and force-unpair clear tokens, groups, and active sessions with audit logs.
- Security hold entry/clear is audited; hold is enforced via pairing sessions and ownership_state until hold_until elapses.
- Agent pairing handling now uses UDP helpers and simulator coverage (JSON framing); REMP framing/hardware validation remains outstanding, so edge/race validation is still pending.

## Context and Orientation

Pairing is a multi step flow between the UI, Cloud API, agent, and dongle. The API provides endpoints under `/api/v1/dongles/:id/pairing-mode` and `/api/v1/dongles/:id/pairing-submit`. The agent sends REMP messages `PAIRING_MODE_START` and `PAIRING_SUBMIT` over UDP to the dongle. The dongle emits `PAIRING_OK` or `PAIRING_FAIL`. The API must enforce TTL, max PIN attempts, cooldown, and security hold triggers. Ownership is stored in the `dongles` table with an `ownership_state`, and tokens are stored encrypted in `dongle_tokens`.

This plan assumes the database schema and key management plans are implemented, and that the agent discovery plan provides the ability to target a dongle by LAN IP and UDP port.

## Plan of Work

Add a pairing session model or table if it does not exist. Each pairing session should store the dongle ID, user ID, expiration time, attempt count, and current status. Implement the API endpoint to start pairing mode. It should check ownership and security hold state, create or reuse an active pairing session, and instruct the agent to send `PAIRING_MODE_START` with a correlation ID. The response should return `pairing_session_id` and `expires_at`.

Implement the API endpoint to submit the PIN. It should validate the session, check expiry, increment attempt count, and block further attempts if the maximum is exceeded. It should generate a dongle token if the UI did not provide one, encrypt it, and send it to the agent for `PAIRING_SUBMIT` along with the `pairing_nonce`. When the agent reports a `PAIRING_OK`, mark the dongle as owned by the user, update `ownership_state` to `CLAIMED_ACTIVE`, and store the token. If pairing fails, return a `PAIRING_PIN_INVALID` error when the dongle reports a bad PIN. If the maximum attempt count is exceeded, set `SECURITY_HOLD` and apply cooldown logic.

Implement the security hold triggers. Enter `SECURITY_HOLD` when too many wrong PIN attempts occur within a pairing window, when a reset is detected on an owned dongle, when suspicious agent behavior is detected, or when auth anomalies occur. Provide a super admin endpoint to clear the hold by forcing unpair, and ensure the UI displays the correct reason code. Record all hold entry and exit events in the audit log.

Implement unpairing. On user initiated unpair, verify ownership, clear the dongle token, clear group membership, set ownership state to `UNCLAIMED`, and log an audit entry. On admin force unpair, allow unpairing any dongle and include the admin actor in the audit log.

## Concrete Steps

Create a `pairing_sessions` table in the database if not already present, or add it to the Prisma schema in `prisma/schema.prisma`. Ensure it includes fields for dongle ID, user ID, expires at, attempt count, and status. Add API handler implementations in `apps/dashboard-api/src/routes/dongles.ts` for `POST /dongles/:id/pairing-mode` and `POST /dongles/:id/pairing-submit`.

Add an agent control message handler in `apps/bridge-agent/src/ws/control.ts` for pairing commands. Implement UDP commands in `apps/bridge-agent/src/remp/pairing.ts` that send `PAIRING_MODE_START` and `PAIRING_SUBMIT` to the dongle and return `PAIRING_OK` or `PAIRING_FAIL` back to the API.

Add security hold evaluation helpers in `apps/dashboard-api/src/services/security-hold.ts` and call them from pairing and from any reset detection logic. Add audit logging calls for pairing start, pairing submit outcome, unpair, and security hold changes.

Apply the pairing migration and regenerate Prisma client:

    E:\Projets\STM32\workspace\dashboard> $env:DATABASE_URL="postgresql://postgres:dashboard@localhost:5434/dashboard"
    E:\Projets\STM32\workspace\dashboard> npx prisma migrate deploy
    E:\Projets\STM32\workspace\dashboard> npx prisma generate

Implement the real REMP pairing transport in the bridge agent:

- In `apps/bridge-agent/src/remp/pairing.ts`, replace the stub with UDP send/receive using the REMP helpers (`packages/remp`), implement `PAIRING_MODE_START` and `PAIRING_SUBMIT`, and parse `PAIRING_OK`/`PAIRING_FAIL` (including `pairing_nonce`, `token_fingerprint`, and `corr_id`).
- In `apps/bridge-agent/src/agent-core.ts`, wire control WS pairing messages to the real transport and propagate success/failure to the API, with retries/timeouts and clean socket teardown.
- Add a simulator/fake-dongle path (if firmware is unavailable) to allow automated tests to validate the message flow.

End-to-end validation with firmware or simulator:

- Add a test script (e.g., `apps/bridge-agent/src/scripts/test-pairing.ts`) that starts the agent, targets a known dongle IP/port (or simulator), starts pairing mode, submits PIN + nonce, and asserts API transitions: session ACTIVE->SUCCESS, ownership_state `CLAIMED_ACTIVE`, and `dongle_tokens` populated.
- Add negative tests: wrong PIN (max 5 attempts -> SECURITY_HOLD), expired session (TTL 120s), concurrent sessions (first wins), agent offline (AGENT_OFFLINE).
- If firmware is not available in CI, gate firmware-dependent tests behind an env flag and keep simulator tests always running.

## Validation and Acceptance

Start the API and agent. Discover a dongle in pairing mode. Use the UI or curl to call pairing start and verify that a session ID is returned with an expiry about 120 seconds in the future. Submit an incorrect PIN five times and confirm the API returns `PAIRING_SECURITY_HOLD` after the limit and updates the dongle ownership state to `SECURITY_HOLD`. Clear the hold as a super admin and then successfully pair with the correct PIN. Verify that the dongle is now owned by the user and that the token record exists. Finally, unpair the dongle and confirm group membership and token are cleared.

## Idempotence and Recovery

Pairing start is idempotent for an existing active session; it should return the same session and expiry until it expires. Pairing submit should return deterministic errors for invalid sessions or expired sessions. If the agent or dongle is offline, return `AGENT_OFFLINE` and keep the session active until expiry. Unpairing is idempotent and should succeed even if the dongle is already unclaimed.

## Artifacts and Notes

Example pairing submit request payload:

    {
      "pairing_session_id": "uuid",
      "pin": "123456",
      "pairing_nonce": "base64_16_bytes",
      "dongle_token": "base64_bytes"
    }

## Interfaces and Dependencies

In `apps/dashboard-api/src/routes/dongles.ts`, define handlers `startPairingMode(req, res)` and `submitPairing(req, res)` that call `apps/dashboard-api/src/services/pairing.ts` for the core logic.

In `apps/dashboard-api/src/services/pairing.ts`, define `startPairingSession(dongleId, userId)` and `submitPairing(sessionId, pin, nonce, token)` with clear error codes.

In `apps/bridge-agent/src/remp/pairing.ts`, define `sendPairingModeStart(target)` and `sendPairingSubmit(target, payload)` returning the pairing response and status.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
Plan change note: Implemented pairing sessions, PIN attempt limits/hold, unpair/force-unpair, and agent pairing stubs on 2025-12-23; validation against real REMP/edge cases remains pending.
Plan change note: Added explicit tasks for real REMP pairing transport and firmware/simulator validation on 2025-12-23.
Plan change note: Recorded TODO to align agent/dongle pairing with REMP binary framing once firmware supports it; current shim remains JSON over UDP as of 2025-12-23.


