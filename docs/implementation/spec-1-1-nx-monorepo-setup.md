---
title: 'Story 1.1: Nx Monorepo & Local Dev Environment Setup'
type: 'feature'
created: '2026-08-24'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '961e9d12690807790ac22c5d4da6ea114cc01d06'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The repository has no application code yet — no monorepo, no apps, no libraries, no local dev loop — so no subsequent story (ingestion, browse, search, ask) has a working foundation to build on.

**Approach:** Scaffold a fresh Nx monorepo (`apps/web` via Next.js, `apps/api` via NestJS, five empty libs) per the architecture spine's Structural Seed, wire local dev through Docker Compose (Postgres+pgvector only) and env-var-based `DATABASE_URL`, and configure linting + a test runner that pass on the empty scaffold.

## Boundaries & Constraints

**Always:**
- Follow the Structural Seed exactly: `apps/web` (Next.js), `apps/api` (NestJS), empty `libs/ai`, `libs/database`, `libs/documents`, `libs/retrieval`, `libs/shared` (Nx libs kebab-case).
- Docker Compose runs exactly one service: `pgvector/pgvector:pg18` (AD-1, AD-4) — local-dev-only; `apps/api`/`apps/web` run as normal local processes (`nest start`, `next dev`), never containerized.
- All environment-dependent config (DB connection) goes through environment variables read at runtime (`DATABASE_URL`); no hardcoded connection values, no `if isProd` branching (AD-5).
- npm is the package manager (per `stack.md`); pin Node to 24.15.0 via `.nvmrc` + `package.json` `engines` (matches the team's existing Claude Code Node setup — explicit user decision).
- Pin Next.js 16.3.2 and NestJS (`@nestjs/core`) 11.2.1 — both confirmed current on the live npm registry (checked 2026-08-24); Jest as the test runner (per `stack.md`); ESLint for linting (Nx default).
- Leaf libs (`database`, `ai`, `documents`) have zero cross-imports from each other (AD-6) — enforce via Nx's module-boundary tags now, even though they start empty.

**Ask First:** Any dependency, tool, or Nx workspace flag not already named in `stack.md` / the Structural Seed / this spec.

**Never:**
- Implement any ingestion, browse, search, or Ask-the-Archive behavior (Stories 1.2 onward) — this story is scaffold-only.
- Containerize `apps/api` or `apps/web` in Docker Compose (AD-4).
- Introduce a package manager other than npm, or hardcode a DB connection string anywhere in code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Local DB up | `docker-compose up` run from repo root | `pgvector/pgvector:pg18` container starts and accepts connections on its mapped port | N/A |
| API boots against DB | `DATABASE_URL` env var set, `nest start` (or `nx serve api`) run | `apps/api` connects to the Compose Postgres instance with no hardcoded connection values | Missing/invalid `DATABASE_URL` fails fast with a clear startup error, not a silent no-op |
| Frontend dev server | `next dev` (or `nx serve web`) run | `apps/web` starts and serves the default Next.js scaffold page | N/A |
| Empty-scaffold verification | Lint and test targets run at the workspace level | Both succeed (exit 0) against the empty scaffold | A lint or test failure means the story is not done |

</frozen-after-approval>

## Code Map

- `(repo root)` -- currently no `package.json`, `nx.json`, `apps/`, or `libs/` exist; this story creates them from scratch (greenfield).
- `docs/planning/architecture/architecture-federalist_papers_ai_research_assistant-2026-08-24/ARCHITECTURE-SPINE.md` -- authoritative source for the Structural Seed, AD-1, AD-4, AD-5, AD-6, and the pinned Stack table.
- `docs/planning/specs/spec-federalist-research/stack.md` -- npm script conventions (`db:migrate`, `ingest:federalist-papers`, `dev`), Jest as the chosen test runner, local dev command shape.
- `docs/implementation/epic-1-context.md` -- distilled Epic 1 context (goal, cross-story dependencies on this scaffold).
- `spike/docker-compose.yml` (on branch `spike/story-0-1-rag-pipeline`, read via `git show`) -- confirms the `pgvector/pgvector:pg18` image tag and single-service Compose shape already proven working in the Story 0.1 de-risk spike; read-only reference, not reused code (spike is throwaway and now `.gitignore`d).
- `.gitignore` -- already updated this session to exclude `/spike`.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `nx.json`, `.nvmrc` -- Scaffold the Nx workspace at repo root via `create-nx-workspace` (npm, latest Nx), pin Node to 24.15.0 -- establishes the monorepo tool and Node version foundation.
- [x] `apps/web/` -- Generate the Next.js app via the Nx Next.js plugin (pin to Next.js 16.3.2) -- fulfills the AC's `apps/web` requirement.
- [x] `apps/api/` -- Generate the NestJS app via the Nx Nest plugin (pin `@nestjs/core` to 11.2.1) -- fulfills the AC's `apps/api` requirement.
- [x] `libs/ai/`, `libs/database/`, `libs/documents/`, `libs/retrieval/`, `libs/shared/` -- Generate five empty Nx libs (kebab-case) with module-boundary tags preventing `database`/`ai`/`documents` from importing each other -- matches the Structural Seed and enforces AD-6 from the start.
- [x] `docker-compose.yml` -- Add a single `pgvector/pgvector:pg18` service with a mapped Postgres port and no other services -- fulfills AD-4/AD-1.
- [x] `apps/api/.env.example`, NestJS config wiring -- Read `DATABASE_URL` at runtime with no hardcoded values, so `nest start` can reach the Compose DB -- fulfills AD-5.
- [x] Nx-generated ESLint config -- Confirm/adjust so the lint target runs cleanly across the empty scaffold -- fulfills the AC's linting requirement.
- [x] Nx-generated Jest configs (`apps/api`, libs) -- Confirm/adjust so the test target passes on the empty scaffold -- fulfills the AC's test-runner requirement.

**Acceptance Criteria:**
- Given an empty repository, when the scaffolding is complete, then `apps/web` (Next.js), `apps/api` (NestJS), and empty `libs/ai`, `libs/database`, `libs/documents`, `libs/retrieval`, `libs/shared` exist per the Structural Seed.
- Given the scaffold exists, when `docker-compose up` runs, then a `pgvector/pgvector` container pinned to Postgres 18 starts.
- Given the Compose DB is running, when `nest start` and `next dev` run, then both connect via `DATABASE_URL` with no hardcoded connection values in code.
- Given the scaffold, when the lint and test commands run, then both are configured and pass.

## Spec Change Log

- 2026-08-24 -- `@nx/next`'s inferred dev-server target is named `dev` by default (Nx 23.1.1), not `serve`. Set `devTargetName: 'serve'` in `nx.json`'s `@nx/next/plugin` options so `nx serve web` (as literally written in Verification, below) runs `next dev` as intended. No change to the Structural Seed or any AD.
- 2026-08-24 -- The Nx-generated root `eslint.config.mjs` only ignores `**/dist` and `**/out-tsc` by default; it does not ignore `.next` (Next.js's dev/build cache). Without adding `**/.next` to the ignore list, `nx run-many -t lint` fails the first time anyone runs `next dev`/`next build` locally, since ESLint then lints Next's own generated output. Added `**/.next` to the ignore list. Pure scaffold-hygiene fix, no behavioral impact.
- 2026-08-24 -- `apps/api`'s TypeORM wiring reads `DATABASE_URL` directly via `process.env`/`process.loadEnvFile()` (Node 24's native env-file loader) plus a local Zod schema (`apps/api/src/app/env.validation.ts`), rather than adding `@nestjs/config` as a dependency. Same effect (env-var-only config, fail-fast on missing/invalid `DATABASE_URL`) with one fewer dependency; `@nestjs/typeorm`, `typeorm`, `pg`, and `zod` were added since `stack.md`/the Stack table name TypeORM and Zod but no npm packages were pinned to exact install versions before now (typeorm 1.1.0, pg 8.23.0, @nestjs/typeorm 11.0.3 -- all latest-as-of-2026-08-24 and peer-compatible with the pinned NestJS/TypeORM versions).
- 2026-08-24 -- Code review patch round (6 `patch`-classified findings, all fixed, no spec-intent change): (1) `eslint.config.mjs` `depConstraints` was missing `scope:retrieval` (AD-7: may depend on database+ai+shared) and `scope:shared` (AD-9: pure leaf, no deps) entries -- added and verified with temporary bad-import tests. (2) `apps/api/src/main.ts`'s `.env` lookup was cwd-relative and broke when run from `apps/api` with only a repo-root `.env`; reworked to walk up from `process.cwd()` to the nearest `nx.json` (workspace root) and check `apps/api/.env` then `.env` from there, regardless of invocation directory -- verified all four combinations (root/colocated/apps-api-cwd/both-exist-precedence) directly against the built bundle. Also wrapped `process.loadEnvFile` in try/catch (warns and continues rather than crashing on an unreadable env file -- verified with an unreadable path) and added `.catch()` to `bootstrap()` (`Logger.error` + `process.exit(1)` -- verified with a forced `EADDRINUSE`). (3) `env.validation.ts`'s `isPostgresConnectionString` accepted a protocol-only URL (`postgres://`, no host); added a `url.hostname` check. (4) `package.json`: exact-pinned the whole `@nx/*` family to match `nx` core (`23.1.1`), removed the unused `axios` dependency, aligned `pg`/`@types/pg` to matching `8.23.0`. (5) Added `apps/api/src/app/env.validation.spec.ts` -- closes the I/O Edge-Case Matrix's "fails fast" row having zero automated coverage. (6) Added root-level `.env.example` and reworded both `.env.example` files' comments to match the corrected (2)'s colocated-then-root-fallback lookup order.

## Design Notes

Node is pinned to 24.15.0 via `.nvmrc` + `package.json` `engines`, matching the team's existing Claude Code Node setup — an explicit user decision, not derived from the architecture spine (which is silent on Node version). AD-6 (leaf libs never cross-import) is enforced immediately via Nx's module-boundary ESLint rule with scope tags (e.g. `scope:database`, `scope:ai`, `scope:documents`), rather than left to code-review discipline.

## Verification

**Commands:**
- `docker-compose up -d` -- expected: `pgvector/pgvector:pg18` container starts and accepts connections.
- `nx serve api` (or `nest start` from `apps/api`) -- expected: boots and connects to Postgres via `DATABASE_URL` with no errors.
- `nx serve web` (or `next dev` from `apps/web`) -- expected: dev server starts, default page reachable.
- `nx run-many -t lint` -- expected: exit 0 across the whole workspace.
- `nx run-many -t test` -- expected: exit 0 across the whole workspace (Nx-generated smoke tests pass).

## Suggested Review Order

**Entry point**

- `TypeOrmModule` wired via `forRootAsync` so the DB connection is decided at runtime, never hardcoded (AD-5).
  [`app.module.ts:13`](../../apps/api/src/app/app.module.ts#L13)

**Environment validation & fail-fast**

- `validateEnv` throws a clear error instead of booting against a missing/invalid `DATABASE_URL`.
  [`env.validation.ts:34`](../../apps/api/src/app/env.validation.ts#L34)

- Protocol-only URLs (`postgres://`, no host) are now rejected too — closes a real validation gap.
  [`env.validation.ts:19`](../../apps/api/src/app/env.validation.ts#L19)

- Seven cases pin the fail-fast contract so a future edit can't silently regress it.
  [`env.validation.spec.ts:3`](../../apps/api/src/app/env.validation.spec.ts#L3)

**Local `.env` resolution**

- Walks up to the nearest `nx.json` so lookup is correct regardless of invocation directory.
  [`main.ts:19`](../../apps/api/src/main.ts#L19)

- Checks colocated `apps/api/.env` before a repo-root fallback, in that order.
  [`main.ts:40`](../../apps/api/src/main.ts#L40)

- `loadEnvFile` wrapped in try/catch — a malformed `.env` warns instead of crashing the process.
  [`main.ts:47`](../../apps/api/src/main.ts#L47)

- `bootstrap().catch` exits cleanly on startup failure instead of an unhandled rejection.
  [`main.ts:66`](../../apps/api/src/main.ts#L66)

**Local Postgres+pgvector (AD-4)**

- Single `pgvector/pgvector:pg18` service, local-dev-only — no other containers.
  [`docker-compose.yml:3`](../../docker-compose.yml#L3)

**Module boundaries (AD-6, AD-7, AD-9)**

- `depConstraints` enforces leaf-lib isolation and dependency direction at lint time, not by convention.
  [`eslint.config.mjs:18`](../../eslint.config.mjs#L18)

- `scope:retrieval` may depend on `database`+`ai` — matches AD-7's read-path composition.
  [`eslint.config.mjs:35`](../../eslint.config.mjs#L35)

- `scope:shared` may depend on nothing — AD-9's pure-leaf schema lib.
  [`eslint.config.mjs:45`](../../eslint.config.mjs#L45)

**Workspace & tooling config**

- Node pinned to 24.15.0, matching `.nvmrc` and the team's existing Claude Code setup.
  [`package.json:5`](../../package.json#L5)

- Whole `@nx/*` plugin family exact-pinned to match `nx` core — avoids a known Nx version-skew failure mode.
  [`package.json:17`](../../package.json#L17)

- `devTargetName` remapped so `nx serve web` runs `next dev`, matching this spec's own Verification commands.
  [`nx.json:24`](../../nx.json#L24)
