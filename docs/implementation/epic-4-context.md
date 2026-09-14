# Epic 4 Context: Public, Always-On Access

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Anyone with the link — not just the developer running the app locally — can actually use the deployed application, with cost exposure bounded tightly enough that it can be left running indefinitely without risking an unexpected bill or silently exhausting a free-tier quota.

## Stories

- Story 4.1: Deploy to Vercel + Neon
- Story 4.2: Rate Limiting to Bound Cost Exposure

## Requirements & Constraints

- No authentication or user accounts exist anywhere in the app — the system must function entirely without user identity. This is why rate limiting has to key on IP/global counters rather than per-user quotas.
- The unauthenticated AI-backed (ask) endpoint must have bounded cost exposure: both a per-IP limit and a global daily cap, both DB-backed — never in-memory, never Redis.
- No application code may differ between local and production environments — every environment difference is expressed through env vars read at runtime, never an `if isProd`-style branch.
- Real ingested data must exist in the production database before the live URL is shared — the ingestion script runs once against Neon as part of deploy, not left for a visitor to trigger.
- The repo README must explain what the project is and why RAG is the right approach — written for a stranger with zero context landing via the live URL or the repo itself.

## Technical Decisions

**Deployment topology.** `apps/web` and `apps/api` deploy as two separate Vercel Projects against the same repo. `apps/api` uses Vercel's native, zero-config NestJS serverless support (standard `NestFactory.create` + `app.listen()`, no adapter/wrapper) — it runs as a single Vercel Function on Fluid compute. CORS on `apps/api` must be enabled for `apps/web`'s origin. Postgres+pgvector runs on Neon, pinned to a **Postgres 18** project specifically (Neon only serves pgvector 0.8.6 on PG18; older PG versions are held back to pgvector 0.8.0). No self-managed servers, no Docker in production — Compose is local-dev only.

**Nx build config on Vercel — the one real trap.** Do NOT follow Vercel's generic monorepo instructions (set each Project's Root Directory to the app subfolder). Nx needs the whole workspace graph present in the build container, so leave Root Directory at the repo root for both Projects and instead override Build Command (`npx nx build <app>`) and Output Directory (the actual Nx dist path) per Project. Whether Vercel's NestJS zero-config entrypoint detection works when the entrypoint is produced by an Nx build executor (rather than plain `nest build`) is unverified in any doc — treat it as the single biggest deploy risk. De-risk it by deploying a trivial/minimal `apps/api` first and confirming Vercel actually finds and builds the NestJS entrypoint through Nx's output before wiring up the real app.

**Database connection strings — pooled vs. direct.** Provision two separate connection strings, not one: `DATABASE_URL` uses Neon's **pooled** (`-pooler`) endpoint and is used by the running app *and* by the ingestion script (ingestion's per-paper writes are a single transaction each — see AD-10/AD-11 — which transaction pooling supports natively). A second **direct** (non-pooled) connection string is used only for running TypeORM migrations, since migration tooling relies on session-scoped behavior (DDL, `synchronize`, advisory locks) that transaction pooling doesn't support. Add `ssl: true` and a generous `connect_timeout` (e.g. `10`) to the pooled string to absorb Neon's autosuspend cold-start latency. Set `extra.max` on the TypeORM DataSource to a modest number rather than the driver default, since PgBouncer is already doing the real pooling underneath.

**No TypeORM/PgBouncer workaround needed.** TypeORM's Postgres driver (`pg`) only creates a session-persistent *named* prepared statement when a caller explicitly supplies a `name` — TypeORM's query runner doesn't do this for ordinary parameterized queries, so its default query path is already safe against Neon's pooled endpoint. No statement-cache-disabling flag and no switch to `@neondatabase/serverless` is required.

**CORS scope decision.** For this project's scope, CORS on `apps/api` allows only the fixed production `apps/web` origin — simplest, matches a portfolio-scale project, no Preview-to-Preview testing wired up. (If that ever changes, the alternative is a dynamic-origin function using an allowlist plus Vercel's `VERCEL_ENV`/`VERCEL_PROJECT_PRODUCTION_URL` system env vars, since hardcoding breaks every Preview deployment of `apps/web`, whose URL changes per deployment.)

**Fluid compute concurrency caveat.** `apps/api`'s Vercel Function runs on Fluid compute, which can serve concurrent requests from the same warm instance — any module-scoped mutable state would leak across concurrent users. This project's rate-limit design already satisfies this: both counters live in Postgres (see below), not in module-scoped memory, so no change is needed — just worth an explicit "no other module-scoped mutable state exists in `apps/api`" sanity check before go-live.

**Rate limiting design.** Two Postgres-backed counters, same atomic-upsert mechanism, different keys:
- Per-IP throttle: a row keyed by `(ip, minute-bucket)`, limiting requests per minute per caller.
- Global daily cap: a row keyed by `(global, date)`; once total AI-backed requests across all callers hit the configured ceiling, the endpoint returns a clear "daily limit reached, try again tomorrow" message instead of calling the paid/metered AI provider.

Neither counter may use Redis or in-memory storage — both must survive a serverless cold start correctly. Every chat message (including the quill widget's per-message asks from Epic 5) counts as one request against these same counters; there is no special-casing for multi-turn conversations.

## Cross-Story Dependencies

- Story 4.1 is a prerequisite for Story 4.2 in practice: rate limiting's Postgres-backed design only matters once the app is actually running on serverless infrastructure, though both can be built in either order since the counter tables are ordinary schema.
- Story 4.1 depends on Epics 1–3 already working end-to-end locally — it deploys existing functionality, it does not build new user-facing features.
- Epic 5's quill chat widget (per-message asks) consumes the same rate-limit counters this epic establishes — no new limiting mechanism is introduced there.
