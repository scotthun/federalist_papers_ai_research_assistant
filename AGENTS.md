<!-- bmad:context -->
<!-- Verified 2026-08-25 against 8ee71f8. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## federalist_papers_ai_research_assistant

Federalist Papers research assistant: Next.js frontend, NestJS backend, Postgres+pgvector — an Nx monorepo (`apps/web`, `apps/api`, `libs/ai|database|documents|retrieval|shared`). Locked architecture/product decisions live in `docs/planning/`; per-story implementation specs (with decisions and gotchas actually found) live in `docs/implementation/`.

## Where things are

- Per-story specs (`docs/implementation/spec-<N>-<slug>.md`) carry a Code Map, Design Notes, and an append-only Spec Change Log of real decisions/gotchas hit during that story — check before re-deriving something already solved.
- `docs/implementation/deferred-work.md` — known gaps deferred on purpose; check before assuming something was missed.

## Running and verifying

- `npm run test:db-integration` is the only thing that exercises the AD-10 (transaction rollback) and NFR7 (idempotency) guarantees against real Postgres — the default `nx run-many -t test` intentionally skips that suite whenever `DATABASE_URL` isn't set.
- `docker-compose up -d` must be running before `db:migrate`, `ingest:federalist-papers`, `test:db-integration`, or `nx serve api`.

## Conventions that differ from defaults

- Entities never auto-sync (`synchronize: false` in `libs/database/src/lib/data-source.ts`) — schema changes need a real migration added to `databaseMigrations` in that same file (glob-based migration discovery doesn't work once bundled), then `npm run db:migrate`.
- Vendor AI SDKs (e.g. `@google/genai`) are only ever imported inside `libs/ai` — everywhere else goes through the `AIProvider` interface / `ai-provider.factory.ts`. Nx's module boundaries don't block this (they don't restrict npm-package imports), so it's discipline, not enforcement.
- This workspace tags libs by scope only (`scope:database`, `scope:ai`, ...), no `type:*` dimension — confirmed against current Nx docs as a legitimate simplification for a workspace this size (5 libs, 2 apps), not a gap to fix.

## Known pitfalls

- A project with no tag in its `project.json` is blocked from importing *any* other project, not just unlisted ones — Nx's default for untagged projects is total lockout, not lenience. Both `apps/api` (Story 1.2, tagged `scope:api`) and `apps/web` (Story 1.3, tagged `scope:web`) hit this the first time each needed to import from `libs/` — check whether a new/renamed project has a matching tag + `depConstraints` entry before assuming a cross-project import failure is anything more exotic.
- `npm run ingest:federalist-papers` calls the real Gemini API and burns real free-tier quota — running the full 1–85 range more than once or twice in a session will exhaust it (hit twice during Story 1.2). Use `INGEST_FIRST_PAPER`/`INGEST_LAST_PAPER` to scope test runs to 1–2 papers.

<!-- /bmad:context -->
