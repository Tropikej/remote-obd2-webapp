# Bridge Agent Registration and Discovery

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the Bridge Agent can register with the Cloud API, maintain a control WebSocket connection, and discover dongles on the local LAN using the specified UDP discovery protocol. You can see it working by running the agent, observing successful registration and heartbeat logs, and seeing discovered dongles reported to the API with correct device ID and LAN IP values even on machines with multiple network interfaces.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-23 10:02Z) Implement agent registration and token storage.
- [x] (2025-12-23 10:02Z) Implement control WebSocket connection with authentication and heartbeat.
- [x] (2025-12-23 10:02Z) Implement UDP discovery protocol encode and decode with CRC32.
- [x] (2025-12-23 10:02Z) Implement multi NIC broadcast rules and device merge by device ID.
- [x] (2025-12-23 10:02Z) Report discovered dongles to the API and verify end to end.
- [x] (2025-12-29 10:10Z) Hardware discovery validation completed (see plans/execplan-16-bridge-agent-discovery-hardware-validation.md).

## Surprises & Discoveries

- The spec notes `header_len = 16` but the declared fields sum to 18 bytes; we kept 18-byte encode while accepting 16-byte legacy packets to stay compatible.

## Decision Log

- Decision: Implement discovery packet encode and decode in `packages/shared` so both agent and API can reuse constants.
  Rationale: A shared definition avoids drift and lets tests validate packet formats consistently.
  Date/Author: 2025-12-22 / Codex
- Decision: Store the agent token locally using the agent's existing config storage mechanism and never log the token value.
  Rationale: The token is a secret and must not appear in logs, while persistence is needed for reconnects.
  Date/Author: 2025-12-22 / Codex
- Decision: Track hardware discovery validation in a dedicated ExecPlan.
  Rationale: The validation requires embedded firmware access and packet capture evidence beyond this repo.
  Date/Author: 2025-01-06 / Codex

## Outcomes & Retrospective

Bridge agent now registers via API login, stores its token locally, runs UDP discovery per eligible interface, and reports merged device snapshots to the API on a cadence. Control WebSocket support is in place with heartbeat + reconnect, and protocol tests validate CRC enforcement plus ANNOUNCE parsing; API registration/report and control WS harness tests now exercise the new flows. Hardware discovery validation with real firmware is complete, with ANNOUNCE packets decoded and dongles visible in the UI with ownership state.

## Context and Orientation

The Bridge Agent lives in `apps/bridge-agent` and runs as a desktop tray application that can send UDP packets on the local LAN. It communicates with dongles via UDP and the Cloud API via WebSocket. The discovery protocol is a binary framed packet with a header, payload length, and CRC32; the agent sends DISCOVER broadcasts and receives ANNOUNCE responses with TLV fields including device ID, firmware build, and LAN IP. The API provides endpoints for agent registration and reporting discovered devices under `/api/v1/agents`.

Key files expected in the agent app include `apps/bridge-agent/src/main.ts` or `apps/bridge-agent/src/agent.ts` for bootstrap, `apps/bridge-agent/src/api/client.ts` for HTTP calls, `apps/bridge-agent/src/ws/control.ts` for the control WebSocket, and `apps/bridge-agent/src/discovery` for UDP operations. Shared constants should live in `packages/shared/src/protocols/discovery.ts`.

## Plan of Work

Implement the agent registration flow. On first run, the agent should call `POST /api/v1/agents/register` with agent metadata and receive an agent ID and agent token. Persist these in a local configuration file or OS keychain if available. On subsequent runs, the agent should load the token and reuse it; if the token is rejected, it should re register.

Implement the control WebSocket connection. The agent should connect to `wss://<host>/ws/agent` using the agent token for authentication, send a heartbeat every 30 seconds, and listen for control commands from the API. Maintain a reconnection loop with exponential backoff.

Implement discovery packet encoding and decoding. The DISCOVER packet has a fixed header with magic "OBD2", protocol version 1, message type 1, header length 16, payload length 0, a sequence ID, and CRC32 over header plus payload with CRC field zeroed. ANNOUNCE uses TLV payload entries. Implement CRC32 using the standard Ethernet polynomial and validate packets by verifying CRC before parsing TLVs.

Implement interface enumeration and filtering. Enumerate all network interfaces and select only those that are up, not loopback, and have IPv4 plus broadcast address. Exclude interface names matching tun*, tap*, wg*, utun*, ppp*, docker*, br-*, vbox*, vmnet*. For each eligible interface, send a DISCOVER broadcast to that interface's broadcast address. Merge ANNOUNCE responses by device ID and keep the most recent LAN IP for the interface where it was seen. If the same device appears on multiple interfaces, log it at debug level but report a single device to the API.

Report discovered dongles to the API using `POST /api/v1/agents/devices/report`. Include device ID, firmware build, UDP port, capabilities, protocol version, LAN IP, pairing state, and pairing nonce if present. Keep a cached map of discovered devices with timestamps, and report deltas periodically to avoid spamming the API.

## Concrete Steps

From the repo root, inspect the agent package and locate the entry point and config storage mechanism. If none exists, create a simple JSON config file under a user writable directory such as `%APPDATA%` or `~/.config/obd2-dashboard-agent` and store the agent ID and token there.

Add the discovery protocol constants and encode and decode helpers to `packages/shared/src/protocols/discovery.ts`. In `apps/bridge-agent`, add a `discovery` module that sends UDP broadcasts per interface and listens for ANNOUNCE replies, then parses the TLV payload into a typed object.

Add a `control` module for the WebSocket connection. Ensure it authenticates using the agent token and sends heartbeat messages. Add logging for connection status and retries.

Wire discovery results to `apps/bridge-agent/src/api/client.ts` to report devices to the API on a schedule and when state changes.

## Validation and Acceptance

Run the agent locally with a configured API URL and verify the registration flow succeeds and the agent token is stored. Then run discovery in a LAN with a dongle in pairing mode and verify that an ANNOUNCE is parsed and reported to the API. Confirm that on a multi NIC machine with a VPN interface, discovery still works on physical interfaces and ignores excluded virtual interfaces.

Acceptance is achieved when the API receives correct device reports, the agent stays connected to the control WebSocket, and the discovery scanner is stable under repeated scans without crashing or leaking sockets.

## Idempotence and Recovery

Registration is idempotent when the token is valid. If token verification fails, the agent should re register and replace the local token. Discovery is safe to run continuously; if a socket fails or the network disappears, the agent should log the error and retry.

## Artifacts and Notes

Example device report payload shape to the API:

    {
      "devices": [
        {
          "device_id": "0011223344556677",
          "fw_build": "1.2.3",
          "udp_port": 50000,
          "capabilities": 3,
          "proto_ver": 1,
          "lan_ip": "192.168.1.50",
          "pairing_state": 1,
          "pairing_nonce": "base64..."
        }
      ]
    }

## Interfaces and Dependencies

In `packages/shared/src/protocols/discovery.ts`, define constants for magic, protocol version, and message types, and functions `encodeDiscover(seq: number): Buffer` and `decodeAnnounce(buffer: Buffer): AnnouncePayload`.

In `apps/bridge-agent/src/discovery/index.ts`, define `startDiscovery(scannerConfig)` and emit events such as `dongleDiscovered(payload, interfaceInfo)` to the agent core.

In `apps/bridge-agent/src/ws/control.ts`, define `connectControlWs({ agentId, token, apiUrl })` returning an object with `send(message)` and `close()` methods, plus a `status` event emitter.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
Plan change note: Linked hardware discovery validation to plans/execplan-16-bridge-agent-discovery-hardware-validation.md on 2025-01-06.
