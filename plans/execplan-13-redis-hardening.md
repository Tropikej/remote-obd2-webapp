# Redis Hardening and Mandatory Production Configuration

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

Make Redis a first-class, mandatory dependency in production and development so that session storage, data-plane buffering, and SSE behavior do not silently fall back to in-memory mocks. Add explicit fail-fast behavior, environment validation, and observability so misconfiguration is detected early and locally testable. After this change, startup must error if `REDIS_URL` is missing or unreachable; local dev uses a real Redis (e.g., local container). No mock fallback in normal operation.

## Progress

- [ ] Draft plan and requirements.
- [ ] Implement environment validation and fail-fast for production.
- [ ] Add dev guidance to run real Redis locally by default (e.g., docker container); remove mock fallback from normal runs.
- [ ] Provide a simple local Redis setup (docker-compose or one-liner) so devs can validate end-to-end locally.
- [ ] Add health/ready checks to surface Redis status (already present; extend to fail on prod).
- [ ] Add tests covering prod fail-fast vs. dev mock fallback.

## Surprises & Discoveries

None yet.

## Decision Log

- TBD.

## Outcomes & Retrospective

Not started yet.

## Context and Orientation

Redis is used for session storage (connect-pg-simple uses Postgres; Redis currently optional), data-plane buffering, and SSE backlog metrics. The current client falls back to `ioredis-mock` when `REDIS_URL` is unset, which is unsafe in production or dev. We need strict mode everywhere and real Redis by default; no mock fallback in normal runs.

## Plan of Work

1) Env validation: introduce a helper to assert `REDIS_URL` is set (all environments). Fail API startup if missing unless an explicit one-off test override is set for unit tests only.
2) Dev setup: require real Redis in dev; document running a local Redis container for end-to-end validation. Remove mock fallback from normal dev runs.
3) Health/readiness: ensure `/readyz` fails when Redis is unreachable; no mock mode in normal runs. For isolated unit tests, provide a minimal injectable stub, not production codepaths.
4) Docs: update `doc/ops-deploy.md` and `doc/ci-secrets.md` to include `REDIS_URL` and guidance; document the recommended local Redis container for development and the exceptional mock override flag.
5) Tests: add unit tests for Redis client behavior (fail-fast on missing `REDIS_URL`), readiness handler behavior when Redis is down, and injectable stub only for isolated unit tests (not used in runtime).

## Validation and Acceptance

- API refuses to start in any normal mode when `REDIS_URL` is missing.
- In dev with a real Redis URL configured, API starts and `/readyz` reports Redis `ok`.
- No mock fallback in normal runs; only unit-test stubbing via injectable client in tests.
- `/readyz` returns 503 when Redis is unreachable in production-mode settings.
- CI tests cover the client behavior and health reporting.

## Idempotence and Recovery

Config-only change: safe to re-run. If Redis is down in prod, startup should fail fast; once Redis is restored, restart succeeds.

## Artifacts and Notes

- Flags: `REDIS_URL` (required everywhere in normal runs).
- Update Nginx/health docs to mention Redis dependency and recommended local Redis container for dev.
