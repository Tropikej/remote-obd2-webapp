# Bridge Agent Discovery Hardware Validation and Firmware Alignment

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file. It extends `plans/execplan-04-bridge-agent-discovery.md` by adding hardware validation and firmware alignment steps for discovery.

## Purpose / Big Picture

After this change, a novice can run the desktop Bridge Agent and prove that a real dongle is discovered end to end, or can confidently identify the exact mismatch between the agent discovery protocol and the embedded firmware. The result is a repeatable, hardware-backed test procedure that shows discovery working (dongle appears in `/api/v1/dongles` and in the agent logs), or produces evidence that pinpoints why it does not. You can see it working by starting the desktop agent, logging in, running a capture, and observing either a valid ANNOUNCE decoded by the agent or a documented protocol mismatch in the firmware.

## Progress

- [x] (2025-01-06 11:20Z) Drafted the hardware discovery validation plan and documented current failure evidence.
- [x] (2025-12-29 09:30Z) Reproduced the failure with the desktop agent and collected agent logs, API responses, and network capture evidence.
- [x] (2025-12-28 13:40Z) Inspect embedded firmware discovery code and compare packet format, port, and CRC behavior with the dashboard protocol implementation.
- [x] (2025-12-28 13:50Z) Add minimal diagnostics or test harnesses in the dashboard repo to expose discovery failures (decode errors, interface selection, UDP port) without changing behavior.
- [x] (2025-12-29 10:05Z) Preserve discovery ownership state across refreshes so UI reflects API ownership.
- [x] (2025-12-29 10:10Z) Re-run discovery after fixes/config changes and record a passing hardware validation run.

## Surprises & Discoveries

- Observation: After logging in via the desktop agent, no dongles were reported by the API; `GET /api/v1/dongles` returned an empty object.
  Evidence:
    Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/v1/dongles"
    dongles
    -------
    {}
- Observation: Wireshark capture `agent-discovery-working.pcapng` shows valid ANNOUNCE packets (OBD2 header, CRC ok, TLVs present) returning to the host, but the agent UI still showed no discovery results.
- Observation: `/api/v1/dongles` returned an empty list for non-admin users because the API filters to owned dongles only; unclaimed dongles reported by the agent were not visible.
- Observation: The discovery UI showed "Ownership unknown" because discovery refreshes overwrote the in-memory ownership state; the report loop did not rerun when the discovery payload signature was unchanged.
  Evidence: `apps/bridge-agent/src/agent-core.ts` replaced the device snapshot without carrying over ownership fields, leaving them null in UI status.

## Decision Log

- Decision: Treat the current failure as a protocol alignment and evidence-gathering problem before making functional changes.
  Rationale: Without packet-level evidence and firmware inspection, changes to either side risk masking the true mismatch.
  Date/Author: 2025-01-06 / Codex

- Decision: Add lightweight diagnostics in the agent discovery path gated by an env flag, rather than altering discovery behavior.
  Rationale: Logging decode failures and interface selection will show why packets are not accepted without impacting the protocol or timing.
  Date/Author: 2025-01-06 / Codex
- Decision: Bind the discovery socket to the configured port when possible and fall back to an ephemeral port if the bind fails.
  Rationale: Some hosts drop inbound replies to ephemeral ports; binding to the discovery port aligns firewall rules and improves receive reliability.
  Date/Author: 2025-12-28 / Codex
- Decision: List unclaimed dongles alongside owned dongles for authenticated users.
  Rationale: Discovery results are unclaimed by default and should be visible for pairing.
  Date/Author: 2025-12-28 / Codex
- Decision: Preserve ownership state when refreshing discovery snapshots.
  Rationale: Ownership is sourced from the API response; clearing it on every announce causes the UI to regress to "unknown."
  Date/Author: 2025-12-29 / Codex

## Outcomes & Retrospective

Discovery is working end to end. The bridge agent receives ANNOUNCE packets, reports devices to the API, and the UI shows the dongle with ownership state (unclaimed/owned) instead of "unknown." Packet captures confirm valid ANNOUNCE frames, and the API report response includes `ownership_state`.

## Context and Orientation

The Bridge Agent desktop app is built from `apps/bridge-agent`, with the Electron main process at `apps/bridge-agent/src/desktop/main.ts` and a dev runner at `apps/bridge-agent/scripts/dev-desktop.cjs`. The headless agent core is implemented in `apps/bridge-agent/src/agent-core.ts` and the discovery scanner in `apps/bridge-agent/src/discovery/index.ts`. The discovery protocol is defined in `packages/shared/src/protocols/discovery.ts`, which encodes and decodes UDP packets and enforces CRC32 checks. The agent reports discovered devices to the API using `POST /api/v1/agents/devices/report`, and the API lists them via `GET /api/v1/dongles`.

The discovery protocol uses UDP broadcast. A "DISCOVER" packet is a small UDP packet broadcast by the agent to a configured port (default 50000). A "ANNOUNCE" packet is the dongle response. Each packet has a fixed ASCII magic string (`OBD2`), a protocol version (1), a message type (DISCOVER = 0x01, ANNOUNCE = 0x02), a header length (18 for v1, 16 for legacy), a payload length, a sequence number, and a CRC32 over header plus payload. The ANNOUNCE payload is a TLV (type-length-value) list that can include device ID, firmware build string, UDP port, capabilities, protocol version, LAN IP, pairing state, and pairing nonce. These rules are enforced by `packages/shared/src/protocols/discovery.ts`.

The embedded firmware is expected to listen for the DISCOVER packet on the LAN and respond with a valid ANNOUNCE packet. In this plan, the firmware source lives in a separate repository that the next session will have access to.

## Milestones

Milestone 1 establishes a reproducible failure with evidence. At the end, the desktop agent is logged in, the API is running, the discovery scan is active, and you have a capture showing whether any ANNOUNCE packets reached the host. The proof is a saved capture plus agent logs and an API response.

Milestone 2 aligns the firmware and agent protocol. At the end, you have inspected the embedded firmware discovery handler and can state whether it matches the dashboard protocol for magic, version, header length, CRC, and UDP port. The proof is a short written comparison and any code references needed to confirm the mismatch or match.

Milestone 3 validates a working end-to-end discovery flow. At the end, the dongle appears in `GET /api/v1/dongles`, the agent logs show at least one discovery event, and the capture shows ANNOUNCE packets that decode successfully. The proof is terminal output from the API call plus agent logs and a capture snippet.

## Plan of Work

First, reproduce the current failure using the desktop agent. Start Postgres and Redis with the dev compose file, run the API, and launch the desktop agent with `npm run dev:desktop --workspace apps/bridge-agent`. Log in using a dashboard account. Record the agent UI status and confirm the control WebSocket is connected. Run `GET /api/v1/dongles` after login to confirm the list is empty. This is the baseline.

Second, capture UDP traffic on the discovery port while the agent runs. Use Wireshark if available, or the built-in Windows `pktmon` tool. Capture UDP traffic on port 50000 (or the configured port) and verify whether DISCOVER packets are leaving the host and whether ANNOUNCE packets are returning. Save a short capture or event log for later comparison.

Third, inspect the firmware discovery implementation. Search the firmware repo for the magic string `OBD2`, the UDP port, and the message type values (0x01/0x02). Verify that the firmware sends a header length of 18 (or 16 legacy) and computes CRC32 with the same polynomial as `packages/shared/src/protocols/discovery.ts`. Verify that the firmware emits the TLV fields using the same type IDs and endianness (UDP port and capabilities are little-endian in the dashboard implementation). Document any mismatch.

Fourth, add diagnostics in the dashboard repo to make discovery failures visible. Add a debug environment variable, for example `BRIDGE_AGENT_DEBUG_DISCOVERY=1`, that prints the enumerated interfaces, broadcast addresses, and the specific reason a packet decode failed (bad magic, unsupported header length, CRC mismatch). This should be implemented in `apps/bridge-agent/src/discovery/index.ts` and the error path should be behind the flag to avoid log noise in normal runs. Also add a short summary log in `apps/bridge-agent/src/agent-core.ts` when device reports are sent so you can tell whether discovery events reached the API.

Finally, rerun the hardware test after any firmware or agent fixes. Validate that the ANNOUNCE packet decodes, that the agent reports devices, and that the API lists the dongle. Save the logs and capture evidence in the Outcomes section.

## Concrete Steps

All commands below run from `E:\Projets\STM32\workspace\dashboard` unless stated otherwise.

Start dev services and API:

    npm run dev:services
    $env:DATABASE_URL="postgresql://postgres:dashboard@localhost:5434/dashboard-postgres"
    $env:REDIS_URL="redis://localhost:6379"
    $env:SESSION_SECRET="dev-session-secret"
    $env:DONGLE_TOKEN_MASTER_KEY_V1=(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
    npm run dev:api

Launch the desktop agent:

    npm run dev:desktop --workspace apps/bridge-agent

Log in with the desktop UI and confirm the status screen shows an agent ID and a connected status.

Check the API for discovered dongles (PowerShell example):

    $baseUrl = "http://localhost:3000"
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $csrf = (Invoke-RestMethod -Method Get -Uri "$baseUrl/api/v1/auth/csrf" -WebSession $session).token
    $body = @{ email="your-user@example.com"; password="your-password" } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/auth/login" -WebSession $session -Headers @{ "X-CSRF-Token" = $csrf } -ContentType "application/json" -Body $body | Out-Null
    Invoke-RestMethod -Method Get -Uri "$baseUrl/api/v1/dongles" -WebSession $session

Capture UDP traffic using pktmon (if Wireshark is unavailable):

    pktmon filter add -p 50000
    pktmon start --etw -m real-time

Leave it running for at least one discovery interval. Then stop and export:

    pktmon stop
    pktmon pcapng pktmon.etl -o discovery-capture.pcapng

Inspect the firmware repo for discovery behavior. Use ripgrep to find the magic string, port, and CRC32:

    rg -n "OBD2|DISCOVER|ANNOUNCE|50000|crc" <path-to-firmware-repo>

## Validation and Acceptance

Discovery is validated when the desktop agent remains connected, at least one ANNOUNCE packet is captured, the agent logs show a discovery event, and `GET /api/v1/dongles` returns a list with a dongle entry that includes `device_id`, `lan_ip`, `udp_port`, and `last_seen_at`. If discovery still fails, the acceptance for this plan is a written, evidence-backed explanation of the mismatch, including whether the ANNOUNCE packet is missing, malformed, or rejected due to CRC, header length, or TLV differences.

## Idempotence and Recovery

These steps are safe to repeat. If the agent uses a stored token, you can clear it by deleting `%APPDATA%\obd2-dashboard-agent\config.json` and logging in again. Packet capture filters can be removed by running `pktmon filter remove` or by clearing filters before the next run. If a firmware change is applied, rerun the same steps and compare captures and API output.

## Artifacts and Notes

Baseline evidence from the current failure:

    Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/v1/dongles"
    dongles
    -------
    {}

Working evidence from the validated run:

    agent-discovery-working.pcapng
    POST /api/v1/agents/devices/report -> ownership_state=UNCLAIMED

## Interfaces and Dependencies

The discovery protocol is implemented in `packages/shared/src/protocols/discovery.ts` and must remain the source of truth for magic string, header length, CRC32, TLV types, and endianness. The agent discovery scanner is implemented in `apps/bridge-agent/src/discovery/index.ts` and emits `dongleDiscovered` events to `apps/bridge-agent/src/agent-core.ts`, which reports devices via `apps/bridge-agent/src/api/client.ts` to the API endpoint `/api/v1/agents/devices/report`. The desktop app uses the same agent core, so any debug logging or diagnostics added in the agent core or discovery scanner will be visible for both CLI and desktop runs.

Plan change note: Initial version created to guide a new session with access to both dashboard and firmware repositories through a hardware-backed discovery investigation.
