# Project Skeleton Setup

This ExecPlan is a living document. The sections Progress, Surprises and Discoveries, Decision Log, and Outcomes and Retrospective must be kept up to date as work proceeds.

This plan follows `.agent/PLANS.md` and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the repository has a working monorepo skeleton that matches the v0.7 specification. A new developer can install dependencies, run a placeholder API, a placeholder web app, and a placeholder bridge agent, and see each process start successfully. This sets the foundation for all later feature work without forcing later rewrites of project layout.

## Progress

- [x] (2025-12-22 17:51Z) Initial skeleton plan drafted from doc/new-dashboard-spec-v0.7.md.
- [x] (2025-12-22 18:39Z) Create root workspace configuration and shared tooling.
- [x] (2025-12-22 18:39Z) Scaffold API, web, and bridge agent apps with minimal runnable entry points.
- [x] (2025-12-22 18:39Z) Add shared packages and protocol modules as empty shells with exports.
- [x] (2025-12-22 18:39Z) Add infra and prisma directory structure and placeholder configs.
- [x] (2025-12-22 18:39Z) Validate local startup for API, web, and agent.
- [x] (2025-12-22 18:44Z) Add placeholder test script and favicon to keep the skeleton clean.

## Surprises & Discoveries

- npm audit reports 2 moderate severity vulnerabilities after install (not addressed in this skeleton pass).
- `npm test` fails because no test script is defined yet.

## Decision Log

- Decision: Use npm workspaces for the monorepo root to avoid introducing additional tooling at skeleton time.
  Rationale: npm is available by default and supports workspaces cleanly; this keeps setup minimal and accessible for new developers.
  Date/Author: 2025-12-22 / Codex
- Decision: Provide minimal runnable entry points for each app without business logic.
  Rationale: A working skeleton reduces friction and creates known-good wiring for later feature plans.
  Date/Author: 2025-12-22 / Codex

## Outcomes & Retrospective

- Monorepo skeleton created with npm workspaces, shared TypeScript config, and runnable API, web, and bridge agent dev scripts.
- Placeholder shared packages, infra README stubs, and Prisma schema are present to match v0.7 layout.
- Validation: `npm run dev:api`, `npm run dev:web`, and `npm run dev:agent` start successfully and were stopped after confirming startup.
- Playwright verification confirms the web placeholder renders at `http://localhost:5173/` without missing resource errors after adding the favicon.
- Root `npm test` now exits cleanly via a placeholder script, and the web app serves a favicon to avoid 404s.

## Context and Orientation

The v0.7 spec defines a monorepo structure with three apps, two shared packages, Prisma migrations, and infra configs for Nginx and systemd. At present, the repository contains only `doc/` and `.agent/` plus an empty `plans/` directory. The goal of this plan is to create the skeleton directories, minimal package.json files, minimal TypeScript build configuration, and placeholder runtime entry points so future ExecPlans can add features without changing the project layout.

Terms used here:

Monorepo means a single git repository containing multiple packages with shared tooling and dependencies.

Workspace means a set of packages managed together via npm workspaces so they can share dependencies and reference each other.

Entry point means the first file that starts an app process, such as `apps/dashboard-api/src/server.ts`.

## Plan of Work

Create the root workspace configuration. Add a root `package.json` with npm workspaces for `apps/*` and `packages/*`, and add scripts for bootstrapping and running each app. Add a root `tsconfig.base.json` with shared compiler options.

Scaffold the API app under `apps/dashboard-api`. Create `package.json`, `tsconfig.json`, and a minimal Express server in `src/server.ts` that listens on a configured port and returns a JSON response at `/healthz`. Do not implement business logic yet; the endpoint is only to verify the skeleton is runnable. Add a placeholder router under `/api/v1` so later plans can attach routes.

Scaffold the web app under `apps/dashboard-web`. Use Vite with TypeScript and a minimal React app or a static TypeScript entry if React is not desired yet. The app should load and display a minimal page stating the dashboard skeleton is running. Keep dependencies minimal and use Vite defaults to avoid over customizing.

Scaffold the bridge agent under `apps/bridge-agent`. Create a Node and TypeScript package with a single entry point in `src/main.ts` that logs startup, reads a config value for API base URL, and exits cleanly on SIGINT. This is not a tray app yet; it only proves the structure and runtime.

Create shared packages under `packages/shared` and `packages/remp` with empty modules and placeholder exports, so other packages can import without path errors. Provide a shared `index.ts` and a minimal `tsconfig.json` for each package.

Create infra directories under `infra/nginx`, `infra/systemd`, and `infra/scripts` with placeholder README files describing intended usage. Create a `prisma/schema.prisma` file with a placeholder datasource and generator block so the structure exists for the database plan.

## Concrete Steps

From the repo root `E:\Projets\STM32\workspace\dashboard`, create the directory structure that matches the spec:

    apps/dashboard-api
    apps/dashboard-web
    apps/bridge-agent
    packages/shared
    packages/remp
    infra/nginx
    infra/systemd
    infra/scripts
    prisma

Create the root `package.json` with npm workspaces and scripts such as:

    "workspaces": ["apps/*", "packages/*"]
    "scripts": {
      "dev:api": "npm run dev --workspace apps/dashboard-api",
      "dev:web": "npm run dev --workspace apps/dashboard-web",
      "dev:agent": "npm run dev --workspace apps/bridge-agent"
    }

Create `tsconfig.base.json` at the repository root with shared compiler options. Each package should extend this base config.

In `apps/dashboard-api`, add `package.json`, `tsconfig.json`, and `src/server.ts` with an Express server exposing `/healthz` and `/api/v1` placeholder routes.

In `apps/dashboard-web`, run the Vite scaffold or create minimal Vite config files manually. Ensure `npm run dev` starts a web server that renders a placeholder page.

In `apps/bridge-agent`, add `package.json`, `tsconfig.json`, and `src/main.ts` that logs startup and reads `API_BASE_URL` from environment.

In `packages/shared` and `packages/remp`, add `package.json`, `tsconfig.json`, and `src/index.ts` with minimal exports.

In `prisma/schema.prisma`, add a datasource block for Postgres and a generator block for Prisma Client, even if models are not yet defined.

## Validation and Acceptance

Install dependencies at the repo root and run each app:

    npm install
    npm run dev:api
    npm run dev:web
    npm run dev:agent

Acceptance is met when each command starts without errors and the API responds at `/healthz` with HTTP 200, the web app renders a placeholder page in the browser, and the agent logs its startup and can be stopped cleanly.

## Idempotence and Recovery

All changes are additive and safe to re run. If an app fails to start, inspect the corresponding `package.json` scripts and ensure dependencies are installed. If the Vite scaffold created extra files, keep them in place to avoid breaking the dev server.

## Artifacts and Notes

Example API response from `/healthz`:

    { "status": "ok", "service": "dashboard-api" }

## Interfaces and Dependencies

`apps/dashboard-api` depends on Express and TypeScript. The server entry point must be `apps/dashboard-api/src/server.ts`.

`apps/dashboard-web` depends on Vite and TypeScript. The entry point should be `apps/dashboard-web/src/main.tsx` if using React or `apps/dashboard-web/src/main.ts` if using vanilla TypeScript.

`apps/bridge-agent` depends on Node and TypeScript and must expose a CLI entry in `apps/bridge-agent/src/main.ts`.

`packages/shared` and `packages/remp` must compile to JavaScript and export from `src/index.ts` so other packages can import them immediately.

Plan change note: Initial version created from doc/new-dashboard-spec-v0.7.md on 2025-12-22.
