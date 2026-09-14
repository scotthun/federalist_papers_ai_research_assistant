---
title: 'Story 4.2: Rate Limiting to Bound Cost Exposure (via Upstash Redis)'
type: 'feature'
created: '2026-09-14'
status: 'done'
baseline_revision: '235c5ac81d230c43ac96c948868ee3c907f930f2'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/docs/implementation/epic-4-context.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Express `trust proxy: 1`'s hop-count assumption for Vercel's proxy topology was not
      independently verified, so a mismatched real hop count could let a client spoof
      `X-Forwarded-For` and bypass the per-IP throttle.
    evidence: |-
      Blind-hunter and edge-case-hunter both flagged this independently. `trust proxy: 1` is a
      widely-used default for "one reverse proxy" setups and is very likely correct for Vercel's
      Function invocation path, but nothing in this diff or its tests confirms the real hop count
      live against Vercel's current infrastructure.
    location: >-
      apps/api/src/main.ts:65
    severity: medium
  - summary: >-
      POST /api/ask returns no Retry-After/X-RateLimit-* headers on a 429, so callers have no
      machine-readable signal for how long to back off.
    evidence: |-
      Blind-hunter finding. The spec's I/O Matrix only specifies message content for the 429
      responses, not headers, so this is an enhancement beyond the current contract, not a defect
      against it.
    severity: low
  - summary: >-
      RateLimitGuard fails closed on any Upstash error with no circuit breaker, so an Upstash
      outage takes down all of POST /api/ask, not just the rate-limit check.
    evidence: |-
      Blind-hunter finding. This is a deliberate, already-considered tradeoff recorded in the
      spec's own Boundaries & Constraints ("silently allowing unlimited requests during an Upstash
      outage would defeat [the story's purpose]") -- worth revisiting only if real traffic/outage
      frequency ever makes it matter.
    severity: low
  - summary: >-
      Per-IP-cap hits (routine) and global-daily-cap hits (rare, more significant) both log at the
      same Logger.error level with no distinguishing metric an operator could alert on.
    evidence: |-
      Blind-hunter finding -- an observability nice-to-have, not a correctness gap.
    severity: low
  - summary: >-
      The per-IP rate-limit key has no IPv6-specific normalization; multiple IPv6 representations
      of the same client, or rotation within a /64, could undercount against a single caller.
    evidence: |-
      Blind-hunter and edge-case-hunter both raised this. Low-value edge case for this project's
      actual traffic profile (a low-traffic portfolio demo), not worth the added complexity now.
    severity: low
  - summary: >-
      Root and apps/api .env.example files duplicate the same env-var documentation, creating
      drift risk if only one gets updated in the future.
    evidence: |-
      Blind-hunter finding, but this is a pre-existing project-wide convention (every other env var
      in this codebase is already duplicated across both files the same way) -- not something this
      story introduced or should fix in isolation.
    severity: low
  - summary: >-
      The architecture spine's AD-2 (referenced by the superseded decisions.md paragraph) was not
      updated to reflect the Redis-not-Postgres change.
    evidence: |-
      Blind-hunter finding. Real doc-consistency gap, but does not block this story's code from
      being correct or shippable.
    severity: medium
  - summary: >-
      No deployment/ops note warns that forgetting to set UPSTASH_REDIS_REST_URL/TOKEN on the real
      Vercel production project silently ships with zero rate limiting.
    evidence: |-
      Blind-hunter finding. The actual Vercel env-var setup is an interactive step explicitly out
      of this spec's scope (done together in a follow-up walkthrough, per Story 4.1's precedent) --
      worth saying out loud during that walkthrough rather than encoding in this spec.
    severity: medium
---

<intent-contract>

## Intent

**Problem:** `POST /api/ask` is public, unauthenticated, and calls a metered/paid AI provider
(Gemini) with no cost ceiling -- anyone can drive unbounded provider spend or exhaust a free-tier
quota.

**Approach:** Add a single NestJS `CanActivate` guard on `AskController.ask()` backed by Upstash
Redis (`@upstash/ratelimit` + `@upstash/redis`), enforcing a per-IP-per-minute throttle and a
global daily cap -- both env-var-configurable with sensible defaults, both fully inert (no Redis
call, no required setup) whenever the Upstash env vars are unset, which is the default local-dev
state. This supersedes `docs/planning/specs/spec-federalist-research/decisions.md`'s 2026-08-24
"no Redis, Postgres only" amendment -- a deliberate, human-directed change this session, not a
new inference.

## Boundaries & Constraints

**Always:**
- `npm run dev` behaves identically to today with zero setup: no Upstash account, no env vars, no
  new local dependency to run. Both `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` unset
  means the guard always allows the request through -- no Redis call at all.
- The per-IP check runs before the daily check, and both are independent boolean gates: a request
  blocked by the per-IP throttle must never consume the daily cap's budget (it never reaches
  Gemini).
- Both limit values (`ASK_RATE_LIMIT_PER_MINUTE` default `10`, `ASK_DAILY_LIMIT` default `250`) are
  env-var-overridable, parsed the same defensive way this codebase's other numeric env vars
  (`PORT`, `INGEST_*`) already are -- a malformed value falls back to the default, never a crash.
- `request.ip` must resolve the real caller IP behind Vercel's proxy in production and the local
  socket address in local dev, via the same code path (Express `trust proxy`) -- no `isProd`
  branch (AD-5).
- When Upstash *is* configured and a live call to it fails (network blip), fail closed (deny the
  request) -- silently allowing unlimited requests during an Upstash outage defeats the story's
  purpose.

**Block If:** None identified -- limit values, algorithm choice, and Redis-vs-Postgres are already
resolved by prior human decision this session, not open questions.

**Never:**
- No Postgres migration, no new DB table -- this supersedes the original Postgres-upsert design
  entirely, per today's explicit direction.
- No change to `AskService.ask()`'s own logic -- the guard runs before the controller method, the
  service is untouched.
- No blast-radius beyond `POST /api/ask` -- `GET /api/papers*` routes are not rate-limited by this
  story.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Local dev, Upstash unset | No `UPSTASH_*` env vars | Request proceeds normally, no Redis call | N/A |
| Under both limits | IP has made fewer than `ASK_RATE_LIMIT_PER_MINUTE` calls this minute AND global daily count is under `ASK_DAILY_LIMIT` | Request proceeds to `AskService.ask()` | N/A |
| Per-IP limit exceeded | Same IP has already hit `ASK_RATE_LIMIT_PER_MINUTE` this minute | 429, generic "too many requests" message; daily counter NOT incremented | Nest's default exception filter renders the JSON body |
| Daily cap exceeded | Global count has reached `ASK_DAILY_LIMIT` today | 429, exact message "daily limit reached, try again tomorrow" | Same as above |
| Upstash configured but unreachable | Both env vars set, a `.limit()` call throws/network-fails | Request denied (fail closed), not silently allowed | Guard catches the error and throws a 5xx, logged |

</intent-contract>

## Code Map

- `apps/api/src/app/ask/ask.controller.ts:103-139` -- `AskController.ask()`, the `@Post()` handler
  to guard; currently no guards/interceptors on it.
- `apps/api/src/app/ask/ask.module.ts` -- imports `AskService`'s module deps; add
  `RateLimitModule` here.
- `apps/api/src/app/app.module.ts` -- no global guards/middleware registered anywhere today; CORS
  is the only cross-cutting concern, wired in `main.ts`, not here. Do not add the guard globally --
  scope it to `AskController` only.
- `apps/api/src/main.ts` -- `createApp()` (exported for the Vercel serverless entrypoint, Story
  4.1) is where Express's `trust proxy` setting needs enabling, alongside the existing
  `resolveCorsOrigin`/CORS wiring already there.
- `libs/ai/src/lib/ai-provider.provider.ts` -- the existing "one factory-provider per external
  dependency" pattern to mirror for the new Upstash client/`Ratelimit` factories.
- `apps/api/src/app/env.validation.ts` -- existing Zod `envSchema`/`validateEnv()` fail-fast
  pattern for `DATABASE_URL`; the new Upstash vars are deliberately **not** added here (they're
  optional, read via `process.env` directly inside the guard/provider, same "blank means unset" as
  `resolveCorsOrigin` in `main.ts`).
- `apps/api/src/app/ask/ask.controller.spec.ts` -- existing `Test.createTestingModule` +
  mocked-provider testing convention to match for the new guard/controller tests.
- `apps/api/.env.example`, root `.env.example` -- existing per-var commented-documentation
  convention (story reference + why) to extend with the four new vars.
- `docs/planning/specs/spec-federalist-research/decisions.md` -- append a dated entry superseding
  the 2026-08-24 "no Redis" amendment.

## Tasks & Acceptance

**Execution:**
- `package.json` -- add `@upstash/ratelimit` and `@upstash/redis` -- required client libraries.
- `apps/api/src/app/rate-limit/rate-limit.provider.ts` -- new factory building the shared Upstash
  `Redis` client (from `UPSTASH_REDIS_REST_URL`/`TOKEN`, or `undefined` when either is unset) and
  two `Ratelimit` instances (sliding window: `"1 m"`/`ASK_RATE_LIMIT_PER_MINUTE` keyed by IP,
  `"1 d"`/`ASK_DAILY_LIMIT` keyed by a constant `"global"` id) -- isolates Upstash construction
  from the guard, mirroring `ai-provider.provider.ts`'s shape.
- `apps/api/src/app/rate-limit/rate-limit.guard.ts` -- new `CanActivate`: no-op when the client is
  `undefined`; otherwise checks per-IP then global-daily in order, throws the matching 429, fails
  closed on an Upstash-call error -- the actual enforcement logic.
- `apps/api/src/app/rate-limit/rate-limit.module.ts` -- new thin module exporting the guard/
  providers for `AskModule` to import.
- `apps/api/src/app/ask/ask.module.ts` -- import `RateLimitModule`.
- `apps/api/src/app/ask/ask.controller.ts` -- add `@UseGuards(RateLimitGuard)` to `ask()`.
- `apps/api/src/main.ts` -- enable Express `trust proxy` inside `createApp()` so `request.ip`
  resolves correctly behind Vercel's proxy.
- `apps/api/.env.example`, root `.env.example` -- document `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`, `ASK_RATE_LIMIT_PER_MINUTE` (default `10`), `ASK_DAILY_LIMIT`
  (default `250`).
- `docs/planning/specs/spec-federalist-research/decisions.md` -- append the superseding decision
  entry.
- `apps/api/src/app/rate-limit/rate-limit.guard.spec.ts` -- new unit tests covering every I/O
  Matrix row above (mocked `Ratelimit` instances).
- `apps/api/src/app/ask/ask.controller.spec.ts` -- add a test proving `RateLimitGuard` is actually
  wired onto `ask()`.

**Acceptance Criteria:**
- Given no `UPSTASH_*` env vars set, when `POST /api/ask` is called repeatedly, then every call
  proceeds exactly as before this story (no 429, no Redis call).
- Given both env vars set and an IP under both limits, when it calls `POST /api/ask`, then the
  request proceeds to `AskService.ask()` unchanged.
- Given an IP that has already made `ASK_RATE_LIMIT_PER_MINUTE` calls within the current minute,
  when it calls again, then the response is 429 and the global daily counter is not incremented.
- Given the global daily count has reached `ASK_DAILY_LIMIT`, when any caller (under their own
  per-IP limit) calls `POST /api/ask`, then the response is 429 with the exact message "daily
  limit reached, try again tomorrow".
- Given the existing test suite, when run after these changes, then every test still passes.

## Spec Change Log

## Review Triage Log

### 2026-09-14 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6 (medium 3, low 3)
- defer: 8 (medium 3, low 5)
- reject: 4
- addressed_findings:
  - `[medium]` `[patch]` Added an HTTP-level test (`apps/api/src/main.http.spec.ts`) proving
    `trust proxy: 1` resolves `request.ip` as intended, closing a verification-gap and
    intent-alignment finding that no test exercised the proxy/IP-resolution wiring at all. First
    attempt built the app via `createApp()` directly, which pulls in the real `AppModule`'s
    `TypeOrmModule` and only passed because a Postgres container happened to still be running from
    earlier in this session -- caught during my own re-verification pass and corrected to build a
    trivial DB-free module applying the identical `app.set('trust proxy', 1)` line instead, matching
    every other test file's DB-independence.
  - `[low]` `[patch]` Asserted the logger call in `RateLimitGuard`'s two existing fail-closed tests
    -- closes an intent-alignment finding that the "logged" half of the fail-closed I/O matrix row
    was implemented but unasserted.
  - `[medium]` `[patch]` `RateLimitGuard` now throws instead of silently no-op-ing when exactly one
    of `perIpLimiter`/`dailyLimiter` is defined and the other isn't -- closes an edge-case-hunter
    finding that this mismatched state (unreachable via the current provider code, but a latent
    trap for future changes) would silently disable rate limiting instead of failing closed.
  - `[low]` `[patch]` `createRateLimitRedisClient` now logs a warning when exactly one of the two
    Upstash env vars is set -- closes a blind-hunter finding that partial configuration was
    silently treated the same as fully-unset.
  - `[low]` `[patch]` `decisions.md`'s superseded Postgres-counter paragraph is now explicitly
    marked superseded rather than left looking equally current alongside the 2026-09-14 amendment.
  - `[low]` `[patch]` `parseRateLimitIntEnv` now logs a warning when it falls back to the default
    due to a malformed value, rather than silently discarding the operator's intended override.

**Why sliding window, not fixed window:** Upstash's fixed-window algorithm allows a burst of up to
2x the limit right at a window boundary (e.g. 10 requests at 0:59, another 10 at 1:00) -- sliding
window avoids that, at the cost of one extra Redis read per check. Given traffic is expected to be
low for this project, that cost is negligible.

**Why the per-IP check must run first:** the daily cap's definition (epic AC) is "total AI-backed
requests" -- a request already rejected by the per-IP throttle never reaches Gemini, so counting
it against the daily budget would double-penalize legitimate future callers for someone else's
throttled burst.

## Verification

**Commands:**
- `npx nx run-many -t test,build,lint --projects=api` -- expect full pass, no regressions.

**Manual checks (if no CLI):**
- With today's unmodified local `.env` (no `UPSTASH_*` vars), run `npm run dev` and confirm
  `apps/api` boots normally and `POST /api/ask` succeeds repeatedly with no 429 and no new
  required setup step.

## Auto Run Result

**Summary:** Added a NestJS `CanActivate` guard (`RateLimitGuard`) on `POST /api/ask`, backed by
Upstash Redis (`@upstash/ratelimit`), enforcing a per-IP-per-minute throttle (default 10) and a
global daily cap (default 250) -- both env-var-overridable, both fully inert when
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are unset (the default local-dev state, no
setup required). Supersedes the 2026-08-24 Postgres-counter decision per explicit human direction
this session.

**Files changed:**
- `apps/api/src/app/rate-limit/rate-limit.provider.ts` (new) -- Upstash client + two `Ratelimit`
  factories, defensive env-var parsing, warns on partial/malformed config.
- `apps/api/src/app/rate-limit/rate-limit.guard.ts` (new) -- the enforcement guard: no-op when
  Upstash unset, per-IP-then-daily ordering, fails closed (with logging) on both a live-call error
  and a mismatched-limiter-state misconfiguration.
- `apps/api/src/app/rate-limit/rate-limit.module.ts` (new) -- exports the guard and all its
  dependency tokens for `AskModule` to import.
- `apps/api/src/app/rate-limit/rate-limit.guard.spec.ts` (new) -- unit tests covering every I/O
  matrix row plus the review-added misconfiguration/logging/warning cases.
- `apps/api/src/main.http.spec.ts` (new) -- DB-independent HTTP test proving `trust proxy: 1`
  resolves `request.ip` correctly.
- `apps/api/src/app/ask/ask.controller.ts` / `ask.module.ts` -- wires the guard onto `ask()`.
- `apps/api/src/main.ts` -- adds `app.set('trust proxy', 1)` inside `createApp()`.
- `apps/api/src/app/ask/ask.controller.spec.ts`, `ask.http.spec.ts` -- DI wiring for the guard's
  now-required constructor args; one new test asserting the guard is actually attached.
- `apps/api/.env.example`, root `.env.example` -- document the four new env vars.
- `docs/planning/specs/spec-federalist-research/decisions.md` -- superseding decision entry, plus
  an explicit "superseded" marker on the original 2026-08-24 paragraph.
- `package.json`/`package-lock.json` -- added `@upstash/ratelimit`, `@upstash/redis`.

**Review findings breakdown:**
- 6 patches applied (see Review Triage Log above for detail): a real HTTP proxy-resolution test
  (corrected mid-application to avoid a real-DB dependency the first attempt introduced), a logger
  assertion on the fail-closed paths, fail-closed handling for a mismatched-limiter-state edge
  case, a warning log for partial Upstash config, an explicit "superseded" marker in
  `decisions.md`, and a warning log for malformed rate-limit env values.
- 8 items deferred (see frontmatter `deferred`): `trust proxy` hop-count unverified against
  Vercel's real topology, no `Retry-After`/`X-RateLimit-*` headers, no circuit breaker for an
  Upstash outage, no per-IP-vs-daily-cap log/metric distinction, no IPv6-specific normalization,
  `.env.example` duplication (pre-existing project-wide pattern), architecture spine `AD-2` not
  updated, no deployment-walkthrough reminder about setting the real Vercel env vars.
- 4 items rejected: two were artifacts of an incomplete review-prompt excerpt (claimed the guard's
  own test file and the `package.json` diff hunk didn't exist -- both do); one flagged quota being
  consumed before body validation, which is standard, unavoidable NestJS guard-ordering behavior
  across the whole framework, not specific to this change; one flagged the 429 response body shape
  as untested, which trusts well-established Nest framework behavior this codebase doesn't test
  elsewhere either.

**Follow-up review recommendation:** `true` -- patched-finding severity score is `3` medium +
`3` low = `3×3 + 1×3 = 12` (≥ 5 threshold). No `high`-severity patch existed on its own, but the
score crossed the threshold.

**Verification performed:** `npx nx run-many -t test,build,lint --projects=api` -- 20 suites, 294
tests, build and lint all pass (re-run independently after the review patches, not just accepted
from the implementation subagent's own report). Manual local check: killed the stray Nx daemon
that initially made `npm run dev` hang, then confirmed `apps/api` boots cleanly with zero
`UPSTASH_*` vars set and `POST /api/ask` returns 200 on three consecutive real calls -- the guard's
no-op path is genuinely exercised, not just asserted in a unit test.

**Residual risks:** the deferred items above are real but judged non-blocking for this project's
low-traffic, low-stakes threat model. The most consequential one if it turns out wrong is the
`trust proxy: 1` hop-count assumption (deferred, medium severity) -- worth a live check against an
actual deployed request once this ships, since it directly gates whether the per-IP throttle can
be bypassed by a spoofed header.
