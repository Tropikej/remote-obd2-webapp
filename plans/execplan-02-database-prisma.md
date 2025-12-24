# Database Schema and Prisma Migrations

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the dashboard has a complete Postgres schema that matches the v0.7 specification, with all tables, constraints, and indexes needed to support users, sessions, agents, dongles, pairing state, groups, commands, audit logs, and email token flows. You can see it working by running Prisma migrations and then querying the database to confirm the tables and indexes exist and accept inserts.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-22 18:58Z) Implement Prisma models and enums for all v0.7 tables.
- [x] (2025-12-22 18:58Z) Add constraints and indexes required by ownership, groups, and token uniqueness.
- [x] (2025-12-22 19:03Z) Generate and apply migrations, then verify with SQL queries.
- [x] (2025-12-22 18:58Z) Document rollback strategy and safe re-application steps.

## Surprises & Discoveries

- Observation: `npx prisma migrate dev` failed because `DATABASE_URL` is not set.
  Evidence: `Error: Environment variable not found: DATABASE_URL.`
- Observation: Docker is installed but the engine is not running, so a Postgres container could not be started.
  Evidence: `docker: error during connect: ... dockerDesktopLinuxEngine ... The system cannot find the file specified.`
- Observation: Running `npx prisma migrate dev` without a local Prisma CLI installed pulled Prisma 7, which rejects `datasource url` in schema.
  Evidence: `The datasource property \`url\` is no longer supported in schema files.`
- Observation: `gen_random_uuid()` requires the `pgcrypto` extension during SQL verification.
  Evidence: `CREATE EXTENSION IF NOT EXISTS pgcrypto;`

## Decision Log

- Decision: Use Prisma as the single source of schema truth and generate migrations from `prisma/schema.prisma`.
  Rationale: The spec mandates Prisma and migrations must be part of deploys, so Prisma migrations provide a standard workflow.
  Date/Author: 2025-12-22 / Codex
- Decision: Store `device_id` as a normalized 16 character lowercase hex string in Postgres and validate format in the API layer.
  Rationale: It keeps indexes stable and human readable, and matches the spec representation used by APIs and logs.
  Date/Author: 2025-12-22 / Codex
- Decision: Pin Prisma CLI/client to 5.22.0 to keep `datasource url` supported during schema work.
  Rationale: Prisma 7 requires a new config file format; pinning avoids reworking the schema setup during the v0.7 migration plan.
  Date/Author: 2025-12-22 / Codex
- Decision: Add a database-level check constraint to enforce `dongle_a_id != dongle_b_id`.
  Rationale: The spec requires distinct dongles per group and Prisma cannot express this check directly in the schema.
  Date/Author: 2025-12-22 / Codex

## Outcomes & Retrospective

- Prisma models/enums and the full v0.7 schema are defined in `prisma/schema.prisma`.
- Migration SQL was generated into `prisma/migrations` with a check constraint for distinct dongles.
- Prisma dependencies were added to the root workspace, and the migration was applied to a local Postgres container for validation.
- Verified inserts for users, dongles, and groups; check constraint prevents same-dongle groups and unique constraints prevent a dongle from joining two groups.
- `npm test` reports `no tests configured`, so schema validation relies on the migration and SQL verification steps.

## Context and Orientation

The Prisma schema lives at `prisma/schema.prisma` and migrations are stored under `prisma/migrations`. The Express API reads and writes through Prisma and expects the tables defined in v0.7, including users, sessions, agents, agent tokens, dongles, dongle tokens, dongle groups, CAN configs, commands, audit logs, email verification tokens, and password reset tokens. This plan focuses on data layout and constraints only; endpoint logic is implemented in separate plans.

## Plan of Work

Open `prisma/schema.prisma` and ensure the datasource points to Postgres. Define enums for roles, user status, dongle ownership state, group mode, command status, CAN mode, and any other enumerated values used by the API. Define a `User` model with a unique email, password hash, role, status, and timestamps. Define a `Session` model keyed by session ID with a foreign key to user, expiration timestamp, and optional IP and user agent fields, plus indexes on user ID and expires at.

Define `Agent` and `AgentToken` models. `Agent` should capture the user that registered it, a human friendly name, hostname, OS, version, last seen timestamp, and creation timestamp. `AgentToken` should store a token hash and allow revoke with a nullable `revoked_at`.

Define `Dongle` and `DongleToken` models. `Dongle` should include a unique device ID, optional owner user, ownership state enum, last seen, and timestamps. `DongleToken` should be one per dongle, storing key version, nonce, ciphertext, and created timestamp. Ensure a unique constraint on dongle ID so each dongle has at most one token record.

Define `DongleGroup` with a user foreign key, two dongle foreign keys, and a mode enum. Enforce that the two dongles are distinct and each dongle can belong to only one group. This can be expressed by unique constraints on each dongle foreign key and an application layer check for distinctness; if the database supports a check constraint, add it.

Define `CanConfig` as a one to one config for a dongle with the full set of timing and mode fields. Define `Command` to record command invocations and results. Define `AuditLog` to record admin and user actions with actor, target, IP, user agent, details, and timestamp. Define `EmailVerificationToken` and `PasswordResetToken` as hashed token stores with expiry and, for password reset, a used at timestamp. If desired, create an optional `EmailOutbox` table for queued outbound email and mark it as optional in the plan to keep v1 aligned to the spec.

Add indexes for email uniqueness, sessions by user and expiry, commands by dongle and created at, and any other query paths used by the API. Review the spec to ensure every field and enum has a data type and the database model can enforce as much as possible.

## Concrete Steps

From the repo root, check the Prisma schema and update it as described.

    E:\Projets\STM32\workspace\dashboard> Get-Content prisma\schema.prisma

Edit `prisma/schema.prisma` to add or update models. Then generate a migration and apply it in a development environment:

    E:\Projets\STM32\workspace\dashboard> npm install
    E:\Projets\STM32\workspace\dashboard> $env:DATABASE_URL='postgresql://postgres:dashboard@localhost:5434/dashboard'
    E:\Projets\STM32\workspace\dashboard> npx prisma migrate dev --name dashboard_v07_schema

If you do not already have a local Postgres instance, you can start one with Docker:

    E:\Projets\STM32\workspace\dashboard> docker run --name dashboard-postgres -e POSTGRES_PASSWORD=dashboard -e POSTGRES_DB=dashboard -p 5434:5432 -d postgres:16

If `DATABASE_URL` is not set or a Postgres instance is not available yet, generate the migration SQL and commit it while deferring application:

    E:\Projets\STM32\workspace\dashboard> npx prisma migrate diff --from-empty --to-schema-datamodel prisma\schema.prisma --script
    E:\Projets\STM32\workspace\dashboard> mkdir prisma\migrations\<timestamp>_dashboard_v07_schema
    E:\Projets\STM32\workspace\dashboard> # write output to prisma\migrations\<timestamp>_dashboard_v07_schema\migration.sql

If this repository uses a different package manager, replace `npx` with the project standard. Then verify the schema by inspecting tables via Prisma Studio or SQL:

    E:\Projets\STM32\workspace\dashboard> npx prisma studio

Or with psql:

    \dt
    \d+ "User"

If you are using the Docker container above, run SQL checks directly via `psql` in the container:

    E:\Projets\STM32\workspace\dashboard> $setupSql = @'
    \set ON_ERROR_STOP on
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at)
    VALUES (gen_random_uuid(), 'demo@example.com', 'hash', 'user', 'active', now(), now())
    RETURNING id AS user_id \gset

    INSERT INTO dongles (id, device_id, owner_user_id, ownership_state, created_at, updated_at)
    VALUES (gen_random_uuid(), '0011223344556677', :'user_id', 'CLAIMED_ACTIVE', now(), now())
    RETURNING id AS dongle_a_id \gset

    INSERT INTO dongles (id, device_id, owner_user_id, ownership_state, created_at, updated_at)
    VALUES (gen_random_uuid(), '8899aabbccddeeff', :'user_id', 'CLAIMED_ACTIVE', now(), now())
    RETURNING id AS dongle_b_id \gset

    INSERT INTO dongle_groups (id, user_id, dongle_a_id, dongle_b_id, mode, created_at, updated_at)
    VALUES (gen_random_uuid(), :'user_id', :'dongle_a_id', :'dongle_b_id', 'ACTIVE', now(), now())
    RETURNING id;
    '@
    E:\Projets\STM32\workspace\dashboard> $setupSql | docker exec -i dashboard-postgres psql -U postgres -d dashboard

To confirm the check constraint, attempt to create a group with the same dongle in both columns and expect a check constraint error:

    E:\Projets\STM32\workspace\dashboard> $failSameSql = @'
    \set ON_ERROR_STOP on
    WITH new_dongle AS (
      INSERT INTO dongles (id, device_id, owner_user_id, ownership_state, created_at, updated_at)
      SELECT gen_random_uuid(), '1122334455667788', id, 'CLAIMED_ACTIVE', now(), now()
      FROM users WHERE email = 'demo@example.com'
      RETURNING id, owner_user_id
    )
    INSERT INTO dongle_groups (id, user_id, dongle_a_id, dongle_b_id, mode, created_at, updated_at)
    SELECT gen_random_uuid(), owner_user_id, id, id, 'ACTIVE', now(), now()
    FROM new_dongle;
    '@
    E:\Projets\STM32\workspace\dashboard> $failSameSql | docker exec -i dashboard-postgres psql -U postgres -d dashboard

To confirm that a dongle cannot join two groups, attempt to create a second group using an existing dongle and expect a unique constraint error:

    E:\Projets\STM32\workspace\dashboard> $failUniqueSql = @'
    \set ON_ERROR_STOP on
    WITH existing AS (
      SELECT user_id, dongle_a_id FROM dongle_groups LIMIT 1
    ), new_dongle AS (
      INSERT INTO dongles (id, device_id, owner_user_id, ownership_state, created_at, updated_at)
      SELECT gen_random_uuid(), 'aabbccddeeff0011', user_id, 'CLAIMED_ACTIVE', now(), now()
      FROM existing
      RETURNING id
    )
    INSERT INTO dongle_groups (id, user_id, dongle_a_id, dongle_b_id, mode, created_at, updated_at)
    SELECT gen_random_uuid(), existing.user_id, existing.dongle_a_id, new_dongle.id, 'ACTIVE', now(), now()
    FROM existing, new_dongle;
    '@
    E:\Projets\STM32\workspace\dashboard> $failUniqueSql | docker exec -i dashboard-postgres psql -U postgres -d dashboard

## Validation and Acceptance

The schema is correct when migrations apply cleanly, and the tables and indexes match the spec. Verify that you can insert a user, a dongle, and a dongle group without errors. Verify that attempting to create a group with the same dongle in both columns fails, and attempting to place a dongle in two groups fails. Verify that tokens are unique and that session expiry queries can be run with the indexed fields.

## Idempotence and Recovery

Migrations should be additive and reproducible. If a migration fails, revert the local database or restore from a backup and re run `prisma migrate dev`. For production, follow the rollback strategy in the ops plan: take a backup before deploying and restore if a migration needs to be reversed.

## Artifacts and Notes

Example minimal data check after migrations:

    insert into "User"(id, email, password_hash, role, status, created_at, updated_at)
    values (gen_random_uuid(), 'demo@example.com', 'hash', 'user', 'active', now(), now());

## Interfaces and Dependencies

The Prisma models must expose the following types to the TypeScript codebase: `User`, `Session`, `Agent`, `AgentToken`, `Dongle`, `DongleToken`, `DongleGroup`, `CanConfig`, `Command`, `AuditLog`, `EmailVerificationToken`, `PasswordResetToken`, and optionally `EmailOutbox`. The API code will use `PrismaClient` from `@prisma/client` in `apps/dashboard-api/src/db.ts` or a similar module. Define all required enums in the Prisma schema so that TypeScript generated types match the spec names.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
Plan change note: Updated progress, decisions, and concrete steps on 2025-12-22 after implementing the Prisma schema, generating migration SQL, and noting that migration application is blocked until a live Postgres `DATABASE_URL` is available.
Plan change note: Updated progress, outcomes, and concrete steps on 2025-12-22 after applying the migration to a local Docker Postgres instance and validating constraints with SQL.
