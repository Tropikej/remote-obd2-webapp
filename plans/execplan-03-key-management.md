# Key Management and Token Encryption

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, dongle tokens are encrypted at rest with AES-256-GCM, stored with an envelope format, and can be rotated to a new key version without downtime. You can see it working by creating a dongle token record, decrypting it successfully, and running a rotation job that updates the key version while preserving the original token value.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-22 21:17Z) Add crypto helpers for AES-256-GCM envelope format and validation.
- [x] (2025-12-22 21:17Z) Wire encryption and decryption into dongle token persistence.
- [x] (2025-12-22 21:17Z) Implement key rotation job and document safe usage.
- [x] (2025-12-22 21:17Z) Add tests or a validation script to prove encryption and rotation correctness.
- [ ] Add admin-only key rotation endpoint and job orchestration (deferred).

## Surprises & Discoveries

- Observation: Rotation requires a dongle owner user ID to reproduce the AAD used for encryption.
  Evidence: Tokens with null `owner_user_id` are skipped with a warning in the rotation job.

## Decision Log

- Decision: Use Node's built in `crypto` module for AES-256-GCM with explicit nonce and AAD inputs.
  Rationale: It is stable, avoids extra dependencies, and supports the exact envelope format required by the spec.
  Date/Author: 2025-12-22 / Codex
- Decision: Store the dongle token in base64 in memory and convert to bytes for encryption.
  Rationale: The API and agent already exchange base64 strings, so this keeps wire and storage formats consistent.
  Date/Author: 2025-12-22 / Codex
- Decision: Default to the highest available `DONGLE_TOKEN_MASTER_KEY_V*` unless `DONGLE_TOKEN_MASTER_KEY_DEFAULT_VERSION` is set.
  Rationale: It keeps key rotation simple by allowing new keys to become default without code changes.
  Date/Author: 2025-12-22 / Codex

## Outcomes & Retrospective

- AES-256-GCM helpers, key loader, and rotation job are implemented with deterministic AAD handling.
- Dongle token persistence now encrypts and decrypts tokens using the configured key version.
- Rotation job records an audit log entry summarizing the rotation batch.
- Validation script confirms encryption, AAD mismatch failure, and key rotation correctness against a local Postgres DB.
- Key material requirements are documented in `doc/ops-secrets.md`.

## Context and Orientation

Dongle tokens must be encrypted at rest in the database. The envelope format includes key version, nonce, ciphertext, and authentication tag. Associated data must bind the token to the dongle ID, user ID, and created at timestamp so that tokens cannot be moved between records. Keys are provided by environment variables such as `DONGLE_TOKEN_MASTER_KEY_V1` and must be 32 bytes base64. Rotation introduces a new key version, and a background job must re encrypt all older tokens. This plan focuses on the crypto helpers and rotation job; it assumes the Prisma schema already has the `dongle_tokens` table with the required columns.

Relevant files to create or edit include `apps/dashboard-api/src/crypto/dongle-token.ts`, `apps/dashboard-api/src/config/keys.ts`, `apps/dashboard-api/src/jobs/rotate-dongle-keys.ts`, and `packages/shared/src/crypto/envelope.ts` if shared types are desired.

## Plan of Work

Implement a key loader that reads environment variables named `DONGLE_TOKEN_MASTER_KEY_V{n}` and exposes a map of version to key bytes. Validate that the default key version exists and the key is exactly 32 bytes after base64 decode. Provide clear startup errors if the key is missing or malformed.

Implement an encryption helper that takes a token string and an AAD payload with dongle ID, user ID, and created at timestamp. Generate a 12 byte nonce, encrypt with AES-256-GCM, and return the envelope fields. Implement a decryption helper that performs the inverse and rejects any authentication failure. Ensure all conversions between base64 and byte arrays are explicit.

Wire these helpers into the dongle token persistence layer. When a dongle token is created, encrypt it using the default key version and store key version, nonce, ciphertext, and tag (if stored separately). When a dongle token is read for use, decrypt it using the corresponding key version and the original AAD fields from the record.

Implement a rotation job as a standalone script that can be run in production. It should iterate over tokens with an older key version, decrypt with the old key, encrypt with the new key, and update the record. The job should log progress and record a single audit log entry per batch or per record depending on volume. The job must be idempotent and safe to re run.

Add an admin-only rotation trigger endpoint (deferred): create `POST /api/v1/admin/keys/rotate` guarded by `requireRole("super_admin")`. The request payload should include `target_version` and an optional `dry_run` boolean. The handler should validate that the target version exists in the keyring, then enqueue a background rotation job (or run inline in early deployments). The response should return a job ID and current state. Add a `GET /api/v1/admin/keys/rotation/:job_id` endpoint to poll status. The UI should require explicit confirmation because the action re-encrypts all tokens and must only be used by super admins. The endpoint must write an audit log entry for both the request and completion. Provide a note that in early deployments without a job queue, the endpoint can run the rotation inline and return a synchronous summary, but the response must still include counts for rotated and skipped records.

## Concrete Steps

Create `apps/dashboard-api/src/config/keys.ts` to load keys and expose a `getKeyring()` helper. Create `apps/dashboard-api/src/crypto/dongle-token.ts` to implement `encryptDongleToken` and `decryptDongleToken`. Update the dongle token repository module, likely in `apps/dashboard-api/src/services/dongles.ts` or similar, so create and read paths call these helpers.

Add a script entry point `apps/dashboard-api/src/jobs/rotate-dongle-keys.ts` that can be run with node or ts-node. Provide a command in `apps/dashboard-api/package.json` such as `rotate-dongle-keys` to run it.

Document the required env vars and their base64 format in `apps/dashboard-api/README.md` or a new `doc/ops-secrets.md` file so a novice can set them correctly.

## Validation and Acceptance

Create a small test or validation script that encrypts a known token, stores the envelope, and then decrypts it to the same value. Verify that altering any of the AAD fields causes decryption to fail. Run the rotation job with both `DONGLE_TOKEN_MASTER_KEY_V1` and `DONGLE_TOKEN_MASTER_KEY_V2` set, and confirm that all records move to key version 2 while retaining their plaintext value.

For the admin endpoint (deferred), confirm that a non-admin user receives `VALIDATION_ERROR` or `AUTH_SESSION_EXPIRED`, and that a super admin receives a job summary or job ID. Confirm that the audit log includes both the request and completion entries.

## Idempotence and Recovery

Encryption and decryption are pure functions and safe to run repeatedly. The rotation job should skip records already on the target key version, so it can be re run safely. If the job fails mid run, re run it after fixing the error; no records should be lost because ciphertext is replaced only after successful re encryption.

## Artifacts and Notes

Example envelope fields for a single token record:

    key_version: 1
    nonce: base64 12 bytes
    ciphertext: base64 bytes
    tag: base64 16 bytes

## Interfaces and Dependencies

In `apps/dashboard-api/src/crypto/dongle-token.ts`, define:

    type DongleTokenAad = { dongleId: string; userId: string; createdAt: string };
    function encryptDongleToken(token: string, aad: DongleTokenAad): { keyVersion: number; nonce: Buffer; ciphertext: Buffer; tag: Buffer };
    function decryptDongleToken(envelope: { keyVersion: number; nonce: Buffer; ciphertext: Buffer; tag: Buffer }, aad: DongleTokenAad): string;

In `apps/dashboard-api/src/jobs/rotate-dongle-keys.ts`, define a `runRotation(targetVersion: number)` function that uses Prisma to read and update `dongle_tokens`.

For the deferred admin endpoint, define in `apps/dashboard-api/src/routes/admin.ts`:

    POST /api/v1/admin/keys/rotate
      body: { target_version: number, dry_run?: boolean }
      response: { job_id: string, status: "queued" | "running" | "done", rotated: number, skipped: number }

and in `apps/dashboard-api/src/services/rotation.ts` (or similar), define:

    startKeyRotation(targetVersion: number, dryRun: boolean): Promise<{ jobId: string }>
    getKeyRotationStatus(jobId: string): Promise<{ status: string; rotated: number; skipped: number }>

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
Plan change note: Implemented key management, rotation job, documentation, and validation on 2025-12-22.
Plan change note: Added deferred admin rotation endpoint tasks on 2025-12-22.
