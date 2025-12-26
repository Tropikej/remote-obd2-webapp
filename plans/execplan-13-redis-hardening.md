# Redis Hardening and Mandatory Production Configuration

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

Make Redis a first-class, mandatory dependency in production so that session storage, data-plane buffering, and SSE behavior do not silently fall back to in-memory mocks. Add explicit fail-fast behavior, environment validation, and observability so misconfiguration is detected early and locally testable. After this change, production startup must error if `REDIS_URL` is missing or unreachable; local dev should use a real Redis (e.g., local container) by default, with mock only as an explicit, exceptional override for quick unit tests.

## Progress

- [ ] Draft plan and requirements.
- [ ] Implement environment validation and fail-fast for production.
- [ ] Add dev guidance to run real Redis locally by default (e.g., docker container); allow mock only with an explicit override flag for exceptional test scenarios.
- [ ] Add health/ready checks to surface Redis status (already present; extend to fail on prod).
- [ ] Add tests covering prod fail-fast vs. dev mock fallback.

## Surprises & Discoveries

None yet.

## Decision Log

- TBD.

## Outcomes & Retrospective

Not started yet.

## Context and Orientation

Redis is used for session storage (connect-pg-simple uses Postgres; Redis currently optional), data-plane buffering, and SSE backlog metrics. The current client falls back to `ioredis-mock` when `REDIS_URL` is unset, which is unsafe in production. We need a strict mode for production and real Redis in dev by default; mock should only be an explicit override for exceptional test cases.

## Plan of Work

1) Env validation: introduce a helper to assert `REDIS_URL` is set when `NODE_ENV=production` (or when an explicit `REDIS_REQUIRE=true` flag is set). Fail API startup if missing.
2) Dev setup: prefer real Redis even in dev; document running a local Redis container for end-to-end validation. Allow mock only with an explicit override flag intended for quick unit tests, not normal dev runs.
3) Health/readiness: ensure `/readyz` fails when Redis is unreachable; in dev mock mode, mark Redis status as `mock`.
4) Docs: update `doc/ops-deploy.md` and `doc/ci-secrets.md` to include `REDIS_URL` and guidance; document the recommended local Redis container for development and the exceptional mock override flag.
5) Tests: add unit tests for Redis client behavior (prod fail-fast, dev real Redis path, mock override) and readiness handler behavior when Redis is down vs mock.

## Validation and Acceptance

- API refuses to start in production when `REDIS_URL` is missing.
- In dev with a real Redis URL configured, API starts and `/readyz` reports Redis `ok`.
- Mock override exists only for exceptional dev/unit usage (opt-in flag), and `/readyz` reports `mock` in that mode.
- `/readyz` returns 503 when Redis is unreachable in production-mode settings.
- CI tests cover the client behavior and health reporting.

## Idempotence and Recovery

Config-only change: safe to re-run. If Redis is down in prod, startup should fail fast; once Redis is restored, restart succeeds.

## Artifacts and Notes

- Flags: `REDIS_URL` (required in prod), optional dev-only mock override flag (default disabled).
- Update Nginx/health docs to mention Redis dependency and recommended local Redis container for dev.
