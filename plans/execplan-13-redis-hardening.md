# Redis Hardening and Mandatory Production Configuration

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

Make Redis a first-class, mandatory dependency in production and development so that session storage, data-plane buffering, and SSE behavior do not silently fall back to in-memory substitutes. Add explicit fail-fast behavior, environment validation, and observability so misconfiguration is detected early and locally testable. After this change, startup must error if `REDIS_URL` is missing or unreachable; local dev uses a real Redis (e.g., local container).

## Progress

- [x] Draft plan and requirements.
- [x] Implement environment validation and fail-fast (require `REDIS_URL` in normal runs).
- [x] Add dev guidance to run real Redis locally by default (e.g., docker container); remove mock fallback from normal runs.
- [x] Provide a simple local Redis setup (docker-compose) so devs can validate end-to-end locally.
- [x] Add health/ready checks to surface Redis status (already present; now fail fast when Redis missing).
- [x] Add tests covering fail-fast on missing `REDIS_URL` and successful client creation.

## Surprises & Discoveries

None yet.

## Decision Log

- TBD.

## Outcomes & Retrospective

Redis is now mandatory in normal runs: missing `REDIS_URL` causes startup failure, so dev and prod share the same dependency profile. Local setup includes a `docker compose` file for Redis, `.env.example` includes `REDIS_URL`, readiness checks already ping Redis, and tests cover missing/valid Redis URL behavior.

## Context and Orientation

Redis is used for session storage (connect-pg-simple uses Postgres; Redis currently optional), data-plane buffering, and SSE backlog metrics. The current client falls back to an in-memory substitute when `REDIS_URL` is unset, which is unsafe in production or dev. We need strict mode everywhere and real Redis by default.

## Plan of Work

1) Env validation: require `REDIS_URL` in all environments; fail API startup if missing.
2) Dev setup: require real Redis in dev; document running a local Redis container for end-to-end validation. Remove in-memory fallback from normal dev runs.
3) Health/readiness: ensure `/readyz` fails when Redis is unreachable.
4) Docs: update `doc/ops-deploy.md` and `doc/ci-secrets.md` to include `REDIS_URL` and guidance; document the recommended local Redis container for development.
5) Tests: add unit tests for Redis client behavior (fail-fast on missing `REDIS_URL`) and readiness handler behavior when Redis is down.

## Validation and Acceptance

- API refuses to start in any normal mode when `REDIS_URL` is missing.
- In dev with a real Redis URL configured, API starts and `/readyz` reports Redis `ok`.
- `/readyz` returns 503 when Redis is unreachable in production-mode settings.
- CI tests cover the client behavior and health reporting.

## Idempotence and Recovery

Config-only change: safe to re-run. If Redis is down in prod, startup should fail fast; once Redis is restored, restart succeeds.

## Artifacts and Notes

- Flags: `REDIS_URL` (required everywhere in normal runs).
- Update Nginx/health docs to mention Redis dependency and recommended local Redis container for dev.
