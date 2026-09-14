---
title: 'Story 4.1: Deploy to Vercel + Neon -- code prep'
type: 'chore'
created: '2026-09-13'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'eb9383aff4411a0c489ba7d3f9532b0d6ab6901d'
context:
  - '{project-root}/docs/implementation/epic-4-context.md'
  - '{project-root}/docs/planning/research/technical-vercel-nx-nestjs-deployment-2026-08-25/research.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/api` has zero CORS config, an unbounded/default TypeORM connection pool, and
`apps/web`'s `/api/ask` route has no explicit execution-duration ceiling -- none of this matters
running locally, but all three become real correctness/cost risks the moment the app is public
(Epic 4, Story 4.1). Nx's build cache can also silently replay a stale env var value across a
Vercel deployment unless that var is declared as a cache input.

**Approach:** Add env-gated CORS restricted to the production web origin (AD-1), size the shared
TypeORM DataSource's pool deliberately for a serverless/PgBouncer deployment, raise the ask route's
Vercel function duration ceiling to survive slow Gemini calls (observed live this session at
90s+), and declare the relevant env vars as Nx named inputs.

## Boundaries & Constraints

**Always:**
- CORS is enabled only when `WEB_ORIGIN` is set -- unset (today's local dev) means no CORS call at
  all, byte-for-byte unchanged behavior. Never hardcode a URL.
- The same shared `createDataSourceOptions` (`libs/database/src/lib/data-source.ts`) keeps serving
  both the running app and the migrate/ingest Nx targets -- no divergent config path.
- No application code branches on `NODE_ENV`/`isProd` -- every environment difference is an env
  var value, never an `if` (existing convention, AD-5).

**Never:**
- No `vercel.json` or Vercel Project dashboard config in this story -- the Nx-build-output
  entrypoint path for `apps/api` is an explicitly open question in the research doc, flagged to be
  verified empirically during actual deployment, not guessed at now.
- No `ssl` option added to `createDataSourceOptions` -- Neon's own connection string already
  includes `sslmode=require`; that's an operational (which connection-string value gets used)
  concern for the deploy walkthrough, not a code change.
- No change to `migrate.ts`/`ingest.ts` -- the pooled-vs-direct connection string split is which
  value gets passed as `DATABASE_URL` at runtime, not a code change (both already just read
  `DATABASE_URL` from the environment).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Local dev (unchanged) | `WEB_ORIGIN` unset | No CORS call made; any origin works exactly as today | N/A |
| Production | `WEB_ORIGIN` set to the deployed web URL | `app.enableCors({ origin: WEB_ORIGIN })` called before `app.listen()`; only that origin succeeds cross-origin | Browser blocks other origins per standard CORS behavior |

</frozen-after-approval>

## Code Map

- `apps/api/src/main.ts` -- `bootstrap()`: add conditional `app.enableCors(...)` before
  `app.listen()`.
- `libs/database/src/lib/data-source.ts` -- `createDataSourceOptions()`: add a deliberate,
  modest `extra.max` pool size.
- `apps/web/src/app/api/ask/route.ts` -- add a Next.js route-segment `maxDuration` export.
- `nx.json` -- `namedInputs.sharedGlobals` is currently `[]`; add the env vars this app actually
  depends on.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/main.ts` -- add `if (process.env.WEB_ORIGIN) { app.enableCors({ origin: process.env.WEB_ORIGIN }); }` before `app.listen()` -- restricts cross-origin access to the deployed web app's origin only (AD-1), no-op locally.
- [x] `libs/database/src/lib/data-source.ts` -- add `extra: { max: 5 }` to the returned `DataSourceOptions` -- Neon's PgBouncer already pools underneath; a modest per-instance pool avoids stacking many small pools against the shared pooled endpoint under Fluid compute's concurrent-warm-instance model.
- [x] `apps/web/src/app/api/ask/route.ts` -- add `export const maxDuration = 300;` -- raises this route's Vercel Function execution ceiling to the Hobby+Fluid-compute maximum, so a slow Gemini call is never truncated mid-request.
- [x] `nx.json` -- add `{"env": "DATABASE_URL"}`, `{"env": "GEMINI_API_KEY"}`, `{"env": "WEB_ORIGIN"}`, `{"env": "API_BASE_URL"}` to `namedInputs.sharedGlobals` -- prevents Nx's build cache from silently reusing a stale env var value across a Vercel deployment.

**Acceptance Criteria:**
- Given `WEB_ORIGIN` is unset, when `apps/api` boots, then no CORS restriction is applied (unchanged from today).
- Given `WEB_ORIGIN` is set, when a cross-origin request arrives from a different origin, then it's blocked per standard CORS behavior.
- Given the existing test suite, when run after these changes, then every test still passes.
- Given `resolveCorsOrigin` (extracted from `bootstrap()`, mirroring `parsePort`'s existing testable-pure-function pattern in the same file), when covered by unit tests for both I/O matrix rows, then both pass.

## Design Notes

Full technical rationale (Vercel/Nx/NestJS mechanics, the pooled-vs-direct connection string
split, why TypeORM needs no PgBouncer statement-cache workaround) lives in
`docs/planning/research/technical-vercel-nx-nestjs-deployment-2026-08-25/research.md` -- this
story implements only the subset that's well-defined enough to commit as code now; the rest
(Vercel Project setup, the actual `vercel.json`/entrypoint verification, running migrations
against Neon's direct string) is a manual walkthrough once this merges.

## Verification

**Commands:**
- `npx nx run-many -t test,build,lint --projects=api,web --skip-nx-cache` -- expect unchanged pass, no regressions.

**Manual checks (if no CLI):**
- Run `npm run dev` locally with `WEB_ORIGIN` unset -- confirm `apps/api` still boots and serves requests exactly as before.

## Review Notes

Blind-hunter, edge-case-hunter, and verification-gap review layers ran against the diff. Three
findings were patched:

- **`resolveCorsOrigin` had no guard against whitespace-only or literal `"*"` values** (edge-case
  hunter + blind-hunter) -- a blank/whitespace `WEB_ORIGIN` was truthy and would have been passed
  straight to `enableCors`, and `"*"` would have opened cross-origin access to every caller,
  exactly the permissive default this function's contract forbids. Fixed: trims the value, treats
  both blank-after-trim and `"*"` as unset.
- **`ASK_FETCH_TIMEOUT_MS` (`apps/web/src/lib/api-client.ts`) was still `90_000`** despite this
  story raising the ask route's own `maxDuration` to `300` (verification-gap reviewer, confirmed
  directly against source) -- this internal fetch timeout would have self-aborted the exact
  90-94s-long Gemini calls observed live this session *before* the new 300s ceiling could ever
  matter, silently defeating the fix's entire purpose. Raised to `300_000` to match.
- **`WEB_ORIGIN` was undocumented in both `.env.example` files** (blind-hunter) -- added, matching
  this project's strong existing convention of documenting every env var there.

Three findings were deferred to `docs/implementation/deferred-work.md` (pre-existing-pattern gaps
or speculative future tuning, not blocking): `bootstrap()`'s CORS wiring itself is untested beyond
the pure `resolveCorsOrigin` function (matches `parsePort`'s identical, already-accepted
convention in the same file); no `idleTimeoutMillis`/`connectionTimeoutMillis` on the DataSource
pool; no startup log line for CORS enabled/disabled state.

Remaining findings were rejected as spec-mandated design choices (single fixed-origin CORS, no
per-target `nx.json` scoping, hardcoded `extra.max`) or false alarms (the `API_BASE_URL` nx.json
addition -- an existing, already-documented var, not new).

## Suggested Review Order

**CORS gating**

- Entry point: env-gated, no-op-when-unset CORS restricted to one origin (AD-1).
  [`main.ts:40`](../../apps/api/src/main.ts#L40)

- Call site wiring the resolved origin into Nest's `enableCors`.
  [`main.ts:51`](../../apps/api/src/main.ts#L51)

- Tests covering unset/blank/whitespace/`"*"`/trimmed-valid cases.
  [`main.spec.ts:29`](../../apps/api/src/main.spec.ts#L29)

**Timeout consistency (the review-caught fix)**

- Raised to stay in sync with the ask route's new 300s function ceiling -- without this, the
  ceiling raise below was silently defeated.
  [`api-client.ts:39`](../../apps/web/src/lib/api-client.ts#L39)

- The Vercel Function duration ceiling this timeout now actually survives past.
  [`route.ts:15`](../../apps/web/src/app/api/ask/route.ts#L15)

**Connection pool sizing**

- Deliberate, modest pool size for a serverless/PgBouncer deployment.
  [`data-source.ts:33`](../../libs/database/src/lib/data-source.ts#L33)

**Build cache correctness**

- Env vars registered as Nx cache inputs so a Vercel build can't silently reuse a stale value.
  [`nx.json:16`](../../nx.json#L16)

**Peripherals**

- `WEB_ORIGIN` documented alongside every other env var.
  [`.env.example:17`](../../apps/api/.env.example#L17)
- Root fallback kept in sync with the same var.
  [`.env.example:11`](../../.env.example#L11)
