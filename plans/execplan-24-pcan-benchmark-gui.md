# PCAN Benchmark GUI for Remote Dongle Performance

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

This plan creates a simple Windows GUI app to benchmark remote dongle CAN performance (latency, ordering, and frame integrity) using a locally attached PCAN USB device. After this change, a user can select a PCAN channel, configure bitrate, send ordered or fuzzed frames with a configurable delay, and watch incoming frames with timestamps and inter-frame delta. The app is local only (not deployed to the VPS) and lives under `apps/` in this repo.

## Progress

- [x] (2026-01-03 10:46Z) Define the PCAN transport layer, settings model, and benchmark pipeline in a new app under `apps/pcan-benchmark`.
- [x] (2026-01-03 10:46Z) Build the WinForms UI for device selection, CAN config, send modes, and frame table with delta timing.
- [x] (2026-01-03 10:46Z) Implement ordered and fuzzed sending loops with configurable delay.
- [x] (2026-01-03 11:08Z) Add E2E UI automation tests and root scripts; run and record results.

## Surprises & Discoveries

- Observation: The PCAN Basic distribution includes a C# wrapper and a native DLL under `E:\Projets\STM32\workspace\PCAN-Basic`.
  Evidence: `E:\Projets\STM32\workspace\PCAN-Basic\Include\PCANBasic.cs` and `E:\Projets\STM32\workspace\PCAN-Basic\x64\PCANBasic.dll`.
- Observation: FlaUI did not expose ComboBox items for the channel list during E2E automation.
  Evidence: The initial test failed on `channelCombo.Items.Length` and was adjusted to rely on connection status instead.

## Decision Log

- Decision: Use .NET 8 WinForms for the GUI and the official `PCANBasic.cs` wrapper from the PCAN Basic package.
  Rationale: PCAN Basic is officially supported by a C# wrapper and a native DLL, which avoids writing native Node bindings and is the simplest path for a Windows GUI.
  Date/Author: 2026-01-03 / Codex

- Decision: Provide a simulated PCAN transport for E2E UI tests.
  Rationale: CI and local test runs may not have PCAN hardware attached; a simulation keeps E2E tests deterministic and still exercises the full UI pipeline.
  Date/Author: 2026-01-03 / Codex

## Outcomes & Retrospective

Implemented a new WinForms PCAN benchmark app under `apps/pcan-benchmark` with a core transport layer, simulated transport, ordered/fuzz sending, and an E2E UI test harness using FlaUI. Added a root `package.json` script for E2E tests and ran `npm run test:pcan-benchmark-e2e` successfully on Windows.

## Context and Orientation

The new app will live in `apps/pcan-benchmark`. It will use the PCAN Basic API distributed at `E:\Projets\STM32\workspace\PCAN-Basic`. The native DLL is `PCANBasic.dll` (x64). The C# wrapper `PCANBasic.cs` defines `TPCANMsg`, `TPCANTimestamp`, `TPCANChannelInformation`, and `PCANBasic` static methods such as `Initialize`, `Read`, `Write`, and `GetValue`. The PCAN timestamp formula is documented in the wrapper: total microseconds is `micros + (1000 * millis) + (0x100000000 * 1000 * millis_overflow)`.

The app is local-only and should not be added to the VPS deploy flow. It is sufficient to commit it to GitHub under `apps/`.

## Plan of Work

Create a new WinForms solution under `apps/pcan-benchmark` with three projects:

1) `PcanBenchmark.Core` (class library) that defines the transport interface, frame models, and benchmark logic. This library should define:
   - `IPcanTransport` with methods `ListChannels()`, `Connect()`, `Disconnect()`, `SetBitrate()`, `ReadLoop()` (event/callback), and `SendFrame()`.
   - `FrameRecord` with timestamp (UTC), delta in microseconds, CAN ID, DLC, payload hex, and channel label.
   - `OrderedPayloadGenerator` that implements the byte-increment behavior described by the user.
   - `FuzzPayloadGenerator` that picks random ID/data/DLC within valid ranges.

2) `PcanBenchmark.App` (WinForms) that implements the GUI and uses `PcanBenchmark.Core`. It should:
   - Provide a dropdown of attached channels by calling `PCANBasic.GetValue(PCANBasic.PCAN_NONEBUS, PCANBasic.PCAN_ATTACHED_CHANNELS, ...)` and showing `TPCANChannelInformation` entries. Display whether each channel is available, occupied, or unavailable using `channel_condition`.
   - Allow bitrate selection via a dropdown of common values (e.g., 125k, 250k, 500k, 1M) mapped to `TPCANBaudrate` values. Keep the UI simple: only classic CAN for now.
   - Include Connect/Disconnect buttons and show connection state.
   - Show a frame table (DataGridView) with columns: Timestamp (UTC), Delta (ms), CAN ID (hex), DLC, Payload (hex). Delta should be computed from the PCAN timestamp values using the formula in `PCANBasic.cs`.
   - Provide send controls: mode selector (Ordered or Fuzz), base CAN ID input (hex), DLC input, and delay in milliseconds. Starting the send loop should send frames at the configured interval on a background task, with a stop button to halt.
   - Keep a rolling buffer (e.g., last 1,000 frames) for the table to avoid unbounded memory growth.

3) `PcanBenchmark.E2E` (test project) that uses UI automation to validate the app end-to-end. Use `FlaUI.UIA3` (or WinAppDriver if preferred) to:
   - Launch the app in a `--simulate` mode that uses a simulated transport instead of real PCAN hardware.
   - Verify the channel dropdown lists a simulated device.
   - Connect, start the ordered send loop with a short delay, and assert that new rows appear in the frame table with non-zero delta values.

PCAN Basic integration details:

- Add `PCANBasic.cs` to `PcanBenchmark.App` via a linked file pointing to `E:\Projets\STM32\workspace\PCAN-Basic\Include\PCANBasic.cs`.
- Copy `PCANBasic.dll` from `E:\Projets\STM32\workspace\PCAN-Basic\x64\PCANBasic.dll` to the output directory on build. Target `x64` so the DLL architecture matches.
- Add a clear startup error when the DLL is missing (show a MessageBox explaining the required path and how to configure it).
- Allow overriding the PCAN Basic path by an environment variable `PCAN_BASIC_DIR`, falling back to the default path above.

Add root scripts in `package.json` as the canonical entry points:

- `test:pcan-benchmark-e2e`: runs `dotnet test` for `PcanBenchmark.E2E`.
- Optionally, `test:pcan-benchmark-core`: runs unit tests for core logic if you add them.

## Concrete Steps

All commands run from `E:\Projets\STM32\workspace\dashboard`.

1) Create the new app directory and solution:

  mkdir apps\\pcan-benchmark
  cd apps\\pcan-benchmark
  dotnet new sln -n PcanBenchmark
  dotnet new classlib -n PcanBenchmark.Core
  dotnet new winforms -n PcanBenchmark.App
  dotnet new xunit -n PcanBenchmark.E2E
  dotnet sln PcanBenchmark.sln add PcanBenchmark.Core\\PcanBenchmark.Core.csproj
  dotnet sln PcanBenchmark.sln add PcanBenchmark.App\\PcanBenchmark.App.csproj
  dotnet sln PcanBenchmark.sln add PcanBenchmark.E2E\\PcanBenchmark.E2E.csproj

2) Implement the core transport, payload generators, and frame pipeline in `PcanBenchmark.Core`.
3) Implement the WinForms UI in `PcanBenchmark.App` and wire it to the core.
4) Add the simulated transport and E2E UI test in `PcanBenchmark.E2E`.
5) Add the root `package.json` scripts to invoke the E2E tests.

## Validation and Acceptance

Acceptance is met when:

- The GUI lists attached PCAN channels, connects successfully, and displays incoming frames with correct timestamp and delta calculations.
- The ordered sender increments payload bytes exactly as specified, and the fuzz sender emits random IDs/data at the selected delay.
- Switching between remote and local CAN traffic does not crash the app, and the frame table continues updating.
- `npm run test:pcan-benchmark-e2e` passes on a Windows machine (it uses simulated transport and does not require hardware).

## Idempotence and Recovery

The app can be rebuilt and re-run without affecting the VPS. If the PCAN DLL is missing, the app should show a clear error and exit cleanly. Re-running the E2E tests is safe because they use simulation mode only.

## Artifacts and Notes

Expected test output example:

  > npm run test:pcan-benchmark-e2e
  > dotnet test apps\\pcan-benchmark\\PcanBenchmark.E2E\\PcanBenchmark.E2E.csproj
  Passed! 1 test passed.

## Interfaces and Dependencies

Use the PCAN Basic wrapper from `E:\Projets\STM32\workspace\PCAN-Basic\Include\PCANBasic.cs` and the DLL from `E:\Projets\STM32\workspace\PCAN-Basic\x64\PCANBasic.dll`.

Define the following types in `apps/pcan-benchmark/PcanBenchmark.Core`:

- `public interface IPcanTransport` with `IReadOnlyList<PcanChannel> ListChannels()`, `void Connect(PcanChannel, PcanBitrate)`, `void Disconnect()`, `void SendFrame(CanFrame frame)`, and `event EventHandler<FrameRecord> FrameReceived`.
- `public record CanFrame(uint Id, byte[] Data, byte Dlc, bool Extended);`
- `public record FrameRecord(DateTime TimestampUtc, double DeltaMs, uint Id, byte Dlc, string PayloadHex, string ChannelName);`
- `public sealed class OrderedPayloadGenerator` that holds a mutable 8-byte buffer and implements the byte increment behavior.
- `public sealed class FuzzPayloadGenerator` that uses `Random` to generate frames.

Add a simulated transport `SimulatedPcanTransport` in `PcanBenchmark.Core` or `PcanBenchmark.E2E` that emits frames on a timer and supports sending.

Plan change note: Initial ExecPlan created on 2026-01-03 to add a Windows GUI PCAN benchmark tool with ordered/fuzz sending and E2E automation.
Plan change note: 2026-01-03 - Implemented the app structure, UI, and tests; updated the plan after the E2E test passed.
