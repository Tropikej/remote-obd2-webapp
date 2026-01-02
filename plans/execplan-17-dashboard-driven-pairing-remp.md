# Dashboard-Driven Pairing over Binary REMP

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `dashboard/.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, a user can pair a dongle entirely from the dashboard UI using the bridge agent and UDP REMP binary messages. The agent starts pairing mode, the dongle shows a PIN, the user submits it, and the API claims ownership and stores the encrypted token. You can see it working by running the API and agent, starting pairing from the UI, reading the PIN from the dongle, and watching the dongle become `CLAIMED_ACTIVE` with a stored token.

## Progress

- [x] (2025-12-29 12:30Z) Define the binary REMP pairing message format to match the firmware plan.
- [x] (2025-12-29 12:34Z) Update the shared pairing transport to use binary REMP framing instead of JSON.
- [x] (2025-12-29 12:41Z) Persist pairing nonces in the API so the UI does not need to supply them.
- [x] (2025-12-29 12:48Z) Update the bridge agent to return pairing nonces and status to the API.
- [x] (2025-12-29 18:40Z) Configure dongle token master keys in the API environment so pairing submit can encrypt tokens.
- [ ] (2025-12-29 18:55Z) Fix unpair flow for admins/non-owners (use force-unpair or allow admin unpair) to avoid 403 during test resets.
- [x] (2025-12-29 19:10Z) Validate pairing end to end with real firmware (pairing mode, PIN submit, unpair, ownership gating).
- [ ] (2025-12-29 19:25Z) Pair a dongle, power-cycle it, and confirm ownership remains `CLAIMED_ACTIVE` for the same user.

## Surprises & Discoveries

- Observation: Firmware REMP pairing ACKs include the full 31-byte header (magic/version/type/flags/reserved/token_len/fw_build/device_id/seq/timestamp) before the payload; pairing requests must set token_len=0.
  Evidence: `remote-obd2-firmware-h753/Net/remote_bridge.c` and `remote-obd2-firmware-h753/Net/remote_pairing.c` header parsing/building logic.
- Observation: Pairing submit returned HTTP 500 because no dongle token master keys were configured in the API environment.
  Evidence: API error "No dongle token master keys were found in environment variables" from `apps/dashboard-api/src/config/keys.ts`.
- Observation: Unpairing returned 403 even though the dongle was visible in the UI.
  Evidence: `POST /api/v1/dongles/:id/unpair` returned 403; `unpairDongle` rejects when `ownerUserId` is missing or different, and the UI always uses the non-admin endpoint.

## Decision Log

- Decision: Use the binary REMP pairing payload described in `remote-obd2-firmware-h753/plan/dashboard-driven-pairing-execplan.md`.
  Rationale: A shared message format prevents agent/firmware drift and keeps UDP parsing deterministic.
  Date/Author: 2025-12-29 / Codex
- Decision: Store pairing nonces in the `pairing_sessions` table and reuse them during submit.
  Rationale: The UI does not have access to the nonce, so the API must retain it between start and submit.
  Date/Author: 2025-12-29 / Codex
- Decision: Keep the JSON pairing simulator as a test-only helper and remove it from production agent code paths.
  Rationale: Firmware requires binary REMP, but a simulator remains useful for unit tests when hardware is unavailable.
  Date/Author: 2025-12-29 / Codex
- Decision: Populate the REMP `device_id` header bytes only when the dongle id is already a 16-hex device id; otherwise send zeros.
  Rationale: The API control plane passes database UUIDs, while firmware does not validate the device id for pairing; zero-fill keeps framing valid without misrepresenting a device id.
  Date/Author: 2025-12-29 / Codex

## Outcomes & Retrospective

- (2025-12-29) Implemented binary REMP pairing transport, agent/API nonce propagation, pairing nonce migration, and dev keyring configuration.
- (2025-12-29) Validated dashboard UI pairing and unpairing on real hardware; paired dongles are hidden from other user accounts as expected.

## Context and Orientation

Pairing is driven by the dashboard API in `dashboard/apps/dashboard-api/src/services/pairing.ts`. The API uses the control WebSocket (`dashboard/apps/dashboard-api/src/ws/control.ts`) to send pairing commands to the bridge agent, and the agent responds with pairing results. The bridge agent currently sends pairing commands using JSON over UDP in `dashboard/packages/remp/src/pairing.ts`, which does not match firmware expectations. The Prisma model `PairingSession` in `dashboard/prisma/schema.prisma` stores session status, expiry, and attempts, but does not store the dongle’s pairing nonce.

REMP is the Remote Envelope Message Protocol used for UDP communication between the agent and the dongle. It uses a fixed binary header with magic "REMP", version 1, message type, token length, device id, sequence, and timestamp, followed by a payload. Pairing will use REMP message type 3 with the payload defined in the firmware plan.

## Plan of Work

Implement the binary pairing transport shared between the agent and firmware. Start by updating `dashboard/packages/remp/src/pairing.ts` to build and parse binary REMP frames instead of JSON. This shared module must produce the exact payload layout defined in the firmware plan, and it must accept `token_len = 0` for pairing requests. Keep the UDP send/receive logic but replace the JSON encoding with `Buffer` assembly and binary parsing. Add helper functions for `encodePairingStart`, `encodePairingSubmit`, and `decodePairingAck` so the bridge agent code stays readable.

Ensure the API can encrypt dongle tokens by setting `DONGLE_TOKEN_MASTER_KEY_V<version>` (base64 32 bytes) and `DONGLE_TOKEN_MASTER_KEY_DEFAULT_VERSION` in the dev environment, and document them in `.env.example` or setup docs.

Pairing payloads (all multi-byte values are big-endian, same as `remote-obd2-firmware-h753/plan/dashboard-driven-pairing-execplan.md`):

  Start request payload:
    - u8 action = 1 (PAIRING_START)
    - u8 reserved = 0
    - u16 reserved = 0
    - u8 corr_id[16]

  Submit request payload:
    - u8 action = 2 (PAIRING_SUBMIT)
    - u8 reserved = 0
    - u16 reserved = 0
    - u8 corr_id[16]
    - u8 pin[6] (ASCII digits)
    - u8 pairing_nonce[16]
    - u8 token_len
    - u8 token[token_len]

  Response payload (ACK):
    - u8 action = 3 (PAIRING_ACK)
    - u8 status (0=ok, 1=invalid_pin, 2=cooldown, 3=error)
    - u16 seconds (remaining pairing window for start ack, cooldown seconds for submit ack, 0 otherwise)
    - u8 corr_id[16]
    - u8 pairing_nonce[16] (present for start ack when status ok; omitted otherwise)

Update the bridge agent to surface pairing nonces to the API. In `dashboard/apps/bridge-agent/src/agent-core.ts`, include `pairing_nonce` in the `pairing_mode_started` response. In `dashboard/apps/bridge-agent/src/remp/pairing.ts`, return `pairing_nonce` and any expiry value parsed from the pairing ACK. Update `dashboard/apps/bridge-agent/src/scripts/test-pairing.ts` to use the binary transport by default and keep the JSON simulator only when an explicit environment flag is set.

Persist pairing nonces in the API. Add a nullable `pairingNonce` field to `PairingSession` in `dashboard/prisma/schema.prisma` (type `Bytes`), run a migration, and regenerate the Prisma client. Update `startPairingSession` in `dashboard/apps/dashboard-api/src/services/pairing.ts` to read the agent response and store the nonce and any updated expiry. Update `submitPairing` to use the stored nonce when the client does not provide one, and include it when sending `pairing_submit` to the agent. Keep the UI payload unchanged; it should only send `pairing_session_id` and `pin`.

Align error handling. Ensure that agent responses map to API errors (`PAIRING_PIN_INVALID`, `PAIRING_SECURITY_HOLD`, `AGENT_OFFLINE`) as currently implemented. Any new pairing ACK status codes introduced by firmware must be translated to these existing API error codes.

Align unpair permissions with the UI. If the viewer is `super_admin`, call `/api/v1/admin/dongles/:id/force-unpair` from the dongle detail page. Otherwise, show a clear error when the dongle is owned by another user and avoid a failing request loop.

## Concrete Steps

All commands run from `E:\Projets\STM32\workspace\dashboard`.

Update Prisma and regenerate:

  $env:DATABASE_URL="postgresql://postgres:dashboard@localhost:5434/dashboard-postgres"
  npx prisma migrate dev -n pairing-nonce
  npx prisma generate

Run the agent and API for manual validation:

  npm run dev:api
  npm run dev:desktop --workspace apps/bridge-agent

## Validation and Acceptance

Start the API and bridge agent, then discover the dongle. From the UI, start pairing mode and confirm the API returns a session ID and expiry while the agent logs show a pairing ACK containing a nonce. Submit the PIN and confirm the API response marks the dongle as owned. Verify that `pairing_sessions.pairing_nonce` is set and that `dongle_tokens` has a row for the paired dongle. The agent must report `status=invalid_pin` on a wrong PIN and the API must return `PAIRING_PIN_INVALID` without crashing.

Acceptance is met when the dashboard-driven flow completes with a real dongle using the binary REMP pairing payload, without requiring HTTPS pairing or manual token injection.

## Idempotence and Recovery

Starting pairing mode multiple times should reuse an active session and return the same nonce until expiry. If the agent or dongle is offline, the API must return `AGENT_OFFLINE` and leave the session active until it expires. The migration adding `pairingNonce` is additive and safe to re-run in development.

## Artifacts and Notes

Capture an example agent log line showing the pairing ACK decode and a database query showing `pairing_nonce` populated. Keep a short UI transcript (PIN submitted, ownership updated) as proof.

## Interfaces and Dependencies

In `dashboard/packages/remp/src/pairing.ts`, define:

  export type PairingAck = { status: "ok" | "invalid_pin" | "cooldown" | "error"; expiresInS?: number; pairingNonce?: string; corrId: string };
  export const sendPairingModeStartBinary(target, dongleId, corrId): Promise<PairingAck>;
  export const sendPairingSubmitBinary(target, dongleId, corrId, pin, pairingNonce, dongleToken): Promise<PairingAck>;

In `dashboard/apps/bridge-agent/src/agent-core.ts`, include `pairing_nonce` in the `pairing_mode_started` control response, and include any status metadata in `pairing_result`.

In `dashboard/apps/dashboard-api/src/services/pairing.ts`, add a `pairingNonce` column to the `PairingSession` model and set it from the agent response in `startPairingSession`. In `submitPairing`, prefer the stored nonce when the request does not include one.

Plan change note: 2025-12-29 - Initial plan created to align dashboard pairing with binary REMP and persist pairing nonces.
Plan change note: 2025-12-29 - Added the exact pairing payload layout to keep dashboard and firmware aligned.
Plan change note: 2025-12-29 - Updated progress, decisions, and outcomes after implementing binary REMP pairing, nonce persistence, and agent control updates.
Plan change note: 2025-12-29 - Added a dev keyring configuration task after pairing submit failed with missing master keys.
Plan change note: 2025-12-29 - Added unpair permission alignment after 403 from the non-admin endpoint.
Plan change note: 2025-12-29 - Recorded end-to-end pairing/unpairing validation and ownership gating test.
Plan change note: 2025-12-29 - Marked dev keyring configuration as complete and noted it in outcomes.
