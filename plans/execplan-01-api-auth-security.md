# API Auth and Security Baseline

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, a user can sign up, log in, request a password reset delivered via a pluggable SMTP provider, and stay authenticated using secure server side sessions, with CSRF protection and rate limits enforced on all unsafe requests. An administrator can authenticate, see protected admin routes, and the API always returns a consistent JSON error shape. You can see it working by using curl to sign up and log in, request a password reset token, confirm the reset, then call `/api/v1/auth/me` and admin endpoints to confirm access control and error handling.

## Progress

- [x] (2025-12-22 16:57Z) Initial plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-22 19:29Z) Implement Express app baseline with standardized error handling and request logging.
- [x] (2025-12-22 19:29Z) Add session storage, auth routes, and Argon2id password hashing.
- [x] (2025-12-22 19:29Z) Implement CSRF token issuance and verification middleware for unsafe methods.
- [x] (2025-12-22 19:29Z) Add rate limiting on auth and password reset endpoints.
- [x] (2025-12-22 19:29Z) Add role based authorization middleware for admin routes and verify with curl.
- [x] (2025-12-22 20:22Z) Implement password reset request/confirm flow with hashed tokens and expiry.
- [x] (2025-12-22 20:31Z) Add rate limit validation scripts for signup and password reset.
- [ ] Define email provider interface and SMTP wiring for password reset delivery.

## Surprises & Discoveries

- Observation: `argon2@^0.32.2` did not exist in the registry, so install failed.
  Evidence: `npm error notarget No matching version found for argon2@^0.32.2.`
- Observation: TypeScript type augmentation for Express and sessions required explicit `typeRoots` in the API tsconfig.
  Evidence: `Property 'userId' does not exist on type 'Session & Partial<SessionData>'.`
- Observation: A pre-existing API process on port 3000 masked route changes until the old process was stopped.
  Evidence: `Cannot GET /api/v1/auth/csrf` while `/healthz` responded from the old server.

## Decision Log

- Decision: Use Express with `express-session` and a PostgreSQL backed session store such as `connect-pg-simple`.
  Rationale: The spec requires server side sessions and Postgres is already mandated for the system, so a standard session store keeps state consistent and avoids new infrastructure.
  Date/Author: 2025-12-22 / Codex
- Decision: Use `argon2` for password hashing with Argon2id and explicit parameters stored alongside the hash.
  Rationale: The spec mandates Argon2id, and the `argon2` package exposes that mode with robust defaults.
  Date/Author: 2025-12-22 / Codex
- Decision: Use `connect-pg-simple`'s default `session` table with `createTableIfMissing` to avoid colliding with the Prisma `sessions` table schema.
  Rationale: The Prisma `sessions` table does not match the `connect-pg-simple` schema, so a separate table keeps session storage reliable without schema drift.
  Date/Author: 2025-12-22 / Codex
- Decision: Add `tsconfig` path mappings plus `tsconfig-paths/register` so the API can import `@dashboard/shared` during ts-node dev runs.
  Rationale: Workspace packages are not built in dev, so path mapping avoids runtime module resolution failures.
  Date/Author: 2025-12-22 / Codex
- Decision: Store password reset tokens as SHA-256 hashes and expire them after 60 minutes.
  Rationale: Hashed tokens prevent DB leakage from exposing reset secrets, and a 60 minute TTL balances usability with security for v1.
  Date/Author: 2025-12-22 / Codex
- Decision: Return reset tokens in responses only when `NODE_ENV` is not `production`.
  Rationale: It keeps local validation practical while avoiding exposing tokens in production responses.
  Date/Author: 2025-12-22 / Codex
- Decision: Use a pluggable email provider interface with a default SMTP implementation driven by environment variables.
  Rationale: SMTP is required for password reset delivery, but a provider interface allows swapping to SMTP2GO or a self-hosted SMTP server without changing auth logic.
  Date/Author: 2025-12-22 / Codex

## Outcomes & Retrospective

- API baseline now includes request IDs, request logging, JSON error responses, and `/api/v1` routing.
- Auth routes for signup, login, logout, me, and csrf are live with Argon2id hashing, session storage, and CSRF enforcement.
- Rate limiting is applied to signup/login and password reset routes, and admin role enforcement is in place with a protected `/api/v1/admin/ping` route.
- Password reset request/confirm flows now create hashed tokens, enforce expiry and single use, and update stored password hashes.
- In non production environments the password reset request response includes the token to enable local validation.
- Added local rate limit test scripts under `infra/scripts` and npm scripts to run them.
- SMTP provider wiring is not implemented yet; the plan below describes the interface and wiring points.
- Manual validation confirms CSRF errors, session expiry behavior, role enforcement, and password reset flows; `npm test` still reports `no tests configured`.

## Context and Orientation

The dashboard API lives under `apps/dashboard-api` and is an Express service. The API must expose routes under `/api/v1` and use JSON responses. Server side sessions are stored in Postgres and referenced by a secure HttpOnly cookie. CSRF protection is required because cookies are used for authentication, so the API must issue a CSRF token and require `X-CSRF-Token` on unsafe methods. Rate limits apply to authentication and password reset related endpoints. Password reset tokens are stored hashed in the `password_reset_tokens` table and are short lived. The password reset request should send an email using a provider interface so SMTP can be swapped without changing auth logic. Errors must always use the standard JSON shape with a code string and message so that the UI can render them consistently.

Relevant files that should exist or be created in this plan:
`apps/dashboard-api/src/server.ts` for app bootstrap, `apps/dashboard-api/src/routes/auth.ts` for auth endpoints, `apps/dashboard-api/src/middleware/error-handler.ts` for standard error responses, `apps/dashboard-api/src/middleware/csrf.ts` for CSRF validation, `apps/dashboard-api/src/middleware/rate-limit.ts` for rate limiting, `apps/dashboard-api/src/middleware/auth.ts` for session and role guards, and `packages/shared/src/api/errors.ts` for shared error codes and shapes.

## Plan of Work

First, establish the Express bootstrap so it serves `/api/v1` routes, trusts proxy headers if running behind Nginx, and always emits JSON errors in the required shape. Add a request ID middleware that stores a per request ID on the request object and includes it in logs and error details. Next, implement session handling with a Postgres backed store, set secure cookie flags, and implement basic auth helpers that load the current user from the session. Then implement the auth routes: signup, login, logout, me, and csrf. Signup must hash passwords with Argon2id and persist a user record. Login must verify the password, create a session, and record audit details later when the audit log exists. Logout must clear the session. The `/auth/me` endpoint must return the current user or a standardized error if not authenticated. The `/auth/csrf` endpoint must return a per session token and store it in the session for validation.

Implement password reset flows with two endpoints: `POST /api/v1/auth/password-reset/request` and `POST /api/v1/auth/password-reset/confirm`. The request endpoint should accept an email, respond with `ok: true` whether or not the email exists, and for valid users generate a random token, hash it with SHA-256, store it in `password_reset_tokens` with a one hour expiry, and mark any previous unused tokens for the same user as used. In non production environments, return the token and expiry to allow local validation; in production, deliver the token through the email provider. The confirm endpoint should accept `token` and `password`, validate the token (unused and unexpired), hash the new password with Argon2id, update the user record, and mark the token as used. Return clear error codes for invalid or expired tokens.

Define a pluggable email provider interface so SMTP delivery can be swapped without changing auth logic. The interface should live under `apps/dashboard-api/src/services/email` and export a `sendEmail({ to, subject, text, html })` method. Provide a default SMTP provider (using nodemailer) configured via environment variables: `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and `SMTP_SECURE` (`true` or `false`). Provide a no-op provider for local development when `EMAIL_PROVIDER` is unset or set to `noop`, which logs the intended email and returns success. Add a `PUBLIC_WEB_URL` environment variable used to construct the reset link so the email contents remain stable when deploying. Wire the password reset request handler to call `sendPasswordResetEmail` after creating the token, and return `ok: true` even if sending fails to avoid account enumeration while logging the failure with the request ID.

Add CSRF middleware that rejects unsafe requests without a valid token, with clear error codes. Add rate limit middleware configured for login, signup, and password reset routes. The limits should apply per IP and, where possible, per account to match the spec. Finally, add a role guard so admin endpoints can require `super_admin` and verify this with a sample admin route or a stub route that returns the current user role. Ensure all these routes and middleware consistently emit the standard error shape and include a request ID for traceability.

## Concrete Steps

From the repository root `E:\Projets\STM32\workspace\dashboard`, ensure dependencies are installed for the API package. If the repo uses a workspace tool, use the workspace command; otherwise install in the API directory.

    E:\Projets\STM32\workspace\dashboard> Get-Content package.json

If `packageManager` indicates npm, then:

    E:\Projets\STM32\workspace\dashboard> npm install

If `packageManager` indicates pnpm, then:

    E:\Projets\STM32\workspace\dashboard> pnpm install

Create or edit `apps/dashboard-api/src/server.ts` to initialize Express, add JSON body parsing, request ID middleware, session middleware, and route wiring under `/api/v1`. Create `apps/dashboard-api/src/middleware/error-handler.ts` to normalize errors to the required JSON schema and to ensure non 2xx responses always follow it.

Add `apps/dashboard-api/src/middleware/auth.ts` to read the session user ID, load the user from the database, and attach it to the request. Also add a `requireAuth` and `requireRole("super_admin")` middleware.

Implement CSRF token issuance in `apps/dashboard-api/src/routes/auth.ts` using `GET /api/v1/auth/csrf`, storing the token in the session and returning it in the response. Implement CSRF validation in `apps/dashboard-api/src/middleware/csrf.ts` and apply it to unsafe routes.

Add rate limiting middleware in `apps/dashboard-api/src/middleware/rate-limit.ts`, configured with per route limits from the spec. Wire it into the auth routes where required.

Implement password reset routes in `apps/dashboard-api/src/routes/auth.ts` for `POST /api/v1/auth/password-reset/request` and `POST /api/v1/auth/password-reset/confirm`. Add a helper in `apps/dashboard-api/src/services/password-reset.ts` to generate random tokens, hash them with SHA-256, store them in `password_reset_tokens`, and mark them as used during confirmation. In non production environments, return the token and expiry in the request response to enable local validation.

Implement email provider wiring by creating `apps/dashboard-api/src/services/email/provider.ts` with an `EmailProvider` interface and `apps/dashboard-api/src/services/email/smtp-provider.ts` using nodemailer. Create `apps/dashboard-api/src/services/email/index.ts` to select the provider based on `EMAIL_PROVIDER`. Add `apps/dashboard-api/src/services/email/password-reset.ts` with a `sendPasswordResetEmail({ email, token })` helper that builds a URL from `PUBLIC_WEB_URL` and sends both a text and HTML email. Update the password reset request handler to call this helper and log failures without changing the response.

Add shared error codes in `packages/shared/src/api/errors.ts` and use them in the auth routes. Ensure each error includes a `code`, `message`, and optional `details` object.

## Validation and Acceptance

Start the API locally and confirm it responds as expected. From the repo root, run the API in the way the project expects, for example:

    E:\Projets\STM32\workspace\dashboard> npm run --workspace apps/dashboard-api dev

Make sure `DATABASE_URL` and `SESSION_SECRET` are set before starting the API. If you are using the local Docker Postgres container from the database plan, this is a compatible example:

    E:\Projets\STM32\workspace\dashboard> $env:DATABASE_URL='postgresql://postgres:dashboard@localhost:5434/dashboard'
    E:\Projets\STM32\workspace\dashboard> $env:SESSION_SECRET='dev-secret'

Then exercise the endpoints with curl. The exact host and port depend on the API config, but the expected behaviors are:

    POST /api/v1/auth/signup returns 200 and a JSON body with a user object.
    POST /api/v1/auth/login returns 200 and sets a session cookie.
    GET /api/v1/auth/me returns the same user when the session cookie is present.
    GET /api/v1/auth/csrf returns a JSON object with a token string.
    POST /api/v1/auth/logout clears the session and `/auth/me` returns AUTH_SESSION_EXPIRED.
    POST /api/v1/auth/password-reset/request returns `ok: true` and (in non production) includes a token and expiry.
    POST /api/v1/auth/password-reset/confirm accepts the token and a new password and returns `ok: true`.

Verify CSRF behavior by calling a protected POST without `X-CSRF-Token` and confirm it returns a 4xx error with `code` set to `CSRF_INVALID`. Verify rate limiting by sending more than the limit on the login endpoint and confirm the error response includes a rate limit code and message.

When SMTP is configured, request a password reset for a real inbox and confirm the email contains a reset link with the token. In local development with `EMAIL_PROVIDER=noop`, confirm the server logs the intended email contents and the response still returns `ok: true` (and token if not production).

## Idempotence and Recovery

All middleware and route changes are additive and safe to re-run. If a change to session storage causes startup failure, revert the session store config to a memory store temporarily while keeping the same API routes. If rate limits are too strict during testing, adjust only the test environment configuration, not production defaults.

## Artifacts and Notes

Example error response shape to verify:

    {
      "code": "AUTH_INVALID_CREDENTIALS",
      "message": "Email or password is incorrect.",
      "details": {
        "request_id": "..."
      }
    }

## Interfaces and Dependencies

In `apps/dashboard-api/src/middleware/error-handler.ts`, define an Express error handler with the signature `(err, req, res, next)` that emits the standard JSON error schema and defaults to `INTERNAL_ERROR` when no explicit code is provided.

In `apps/dashboard-api/src/middleware/csrf.ts`, define a middleware `requireCsrf(req, res, next)` that checks `X-CSRF-Token` against the value stored in the session and returns `CSRF_INVALID` on mismatch.

In `apps/dashboard-api/src/middleware/auth.ts`, define `requireAuth` and `requireRole(role)` middleware that attach a `req.user` object and return `AUTH_SESSION_EXPIRED` when unauthenticated.

In `apps/dashboard-api/src/routes/auth.ts`, define handlers for `/auth/signup`, `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/csrf`, `/auth/password-reset/request`, and `/auth/password-reset/confirm` that call into `apps/dashboard-api/src/services/auth.ts` for `hashPassword` and `verifyPassword`, `apps/dashboard-api/src/services/password-reset.ts` for token creation and validation, and `apps/dashboard-api/src/services/email/password-reset.ts` for delivery.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
Plan change note: Updated progress, decisions, and outcomes on 2025-12-22 after implementing auth, CSRF, rate limits, and admin guardrails.
Plan change note: Updated validation steps and outcomes on 2025-12-22 to document required environment variables and the password reset placeholder.
Plan change note: Updated purpose, plan of work, and validation on 2025-12-22 to document the full password reset request/confirm flow and token handling.
Plan change note: Implemented the password reset request/confirm endpoints and updated progress/outcomes on 2025-12-22.
Plan change note: Added local rate limit validation scripts and npm commands on 2025-12-22.
Plan change note: Extended the plan on 2025-12-22 with a pluggable SMTP provider interface and wiring points for password reset delivery.
