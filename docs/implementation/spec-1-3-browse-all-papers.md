---
title: 'Story 1.3: Browse All Papers'
type: 'feature'
created: '2026-08-25'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '26e595a1657421052172f0689a9418db4f643018'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.2 populated real data (85 papers), but there's no way to see it — `apps/web` still shows the default Next.js scaffold page, has no styling system, no connection to `apps/api`, and no lib boundary tag wired up yet.

**Approach:** Wire real `apps/web`→`apps/api` HTTP integration (fixed backend port + configured base URL — the two apps have never actually run together with real cross-calls before), add a `GET /api/papers` endpoint backed by a new `libs/database` read method with the response shape shared via `libs/shared`, set up Tailwind CSS + shadcn/ui (deferred from Story 1.1), and build the Browse Papers page.

## Boundaries & Constraints

**Always:**
- Browse page renders header "Federalist Research", subtitle "Explore the Federalist Papers with source-grounded AI." (UX-DR3), clean academic aesthetic, not a ChatGPT-clone look (UX-DR1/UX-DR2's visual language — the literal two-column split is Epic 3's job, not required here).
- Lists every ingested paper, each row showing number/title/author(s) (UX-DR7), sorted by `paperNumber`.
- Each row links to that paper's reader route (e.g. `/papers/[paperNumber]`) — Story 1.4 builds the actual reader page; this story only needs the link target to exist as a route, a 404 until then is expected sequencing, not a defect.
- `apps/api` exposes an HTTP endpoint returning all papers with author names, sorted by `paperNumber` — a new NestJS module/controller/service, `apps/web` consumes it over HTTP only (Structural Seed) — no direct DB access from the frontend.
- `libs/database` gains a new read method for this, reusing the existing entities from Story 1.2 (separate from the ingestion-focused repository).
- The response shape is a shared TypeScript type in `libs/shared`, imported by both apps — matches `architecture-diagrams.md`'s already-planned `web → shared` dependency edge.
- `apps/api`'s default port moves to 3333 (env `PORT`, still overridable) — it currently defaults to 3000, identical to Next.js's own dev-server default, and the two have never run concurrently with real cross-calls before this story. `apps/web` reads the API's base URL via `API_BASE_URL` (default `http://localhost:3333/api`) — no `NEXT_PUBLIC_` prefix, since it's only ever read server-side (see Spec Change Log).
- `apps/web` is tagged `scope:web` with a matching `eslint.config.mjs` depConstraints entry (`scope:web` may depend on `scope:web`, `scope:shared`) — it currently has no tag at all, which blocks it from importing anything under `libs/` (Nx's default for untagged projects is total lockout, not lenience), the same gap `apps/api` had before Story 1.2 tagged it `scope:api`.
- Tailwind CSS + shadcn/ui set up in `apps/web` (deferred from Story 1.1, due now that real UI exists). Current registry versions (checked live): `tailwindcss`/`@tailwindcss/postcss` 4.3.3, `shadcn` CLI 4.19.0, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.6.0, `lucide-react` 1.34.0, `@radix-ui/react-slot` 1.3.3.

**Ask First:** Any dependency, tool, or Nx workspace flag not already named in `stack.md` / the architecture spine / this spec.

**Never:**
- Implement search, semantic search, or Ask-the-Archive behavior (Epics 2–3).
- Implement the actual Paper Reader page content (Story 1.4) — only the link target.
- Give `apps/web` direct database access.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Browse view, real data | 85 papers ingested (current DB state) | Exactly 85 rows rendered, each with number/title/author(s) | N/A |
| Joint authorship display | Papers 18–20, 62–63 | Row shows every credited author (e.g. "Hamilton, Madison"), never an arbitrary single pick | N/A |
| Empty database | Zero papers ingested | Page renders a clear empty state, no crash | N/A |
| API unreachable | `apps/api` down or unreachable from `apps/web` | Page shows a clear, visible error state | Fetch failure never renders a blank/crashed page |

</frozen-after-approval>

## Code Map

- `docs/planning/specs/spec-federalist-research/ui-design.md`, `docs/planning/epics.md` (UX-DR1/UX-DR2/UX-DR3/UX-DR7 exact wording) -- Browse page requirements.
- `docs/planning/architecture/architecture-federalist_papers_ai_research_assistant-2026-08-24/ARCHITECTURE-SPINE.md` -- `web → shared` dependency edge already drawn in the architecture diagram; CAP-1 Browse capability map (`apps/web` list view ← `apps/api` paper list endpoint ← `libs/database`).
- `docs/implementation/spec-1-2-federalist-ingestion-pipeline.md` (status: done) -- prior story continuity: `FederalistPaper`/`Author`/`DocumentChunk` entities in `libs/database/src/lib/entities/`, existing repository pattern (`paper-ingestion.repository.ts`) to follow for the new read-only repository function.
- `eslint.config.mjs` -- existing `scope:api` depConstraints entry (added in Story 1.2 for the identical "untagged project can't import libs" problem) is the precedent to replicate for `scope:web`.
- `docs/implementation/deferred-work.md` -- the Tailwind/shadcn-ui entry this story resolves.
- `AGENTS.md` -- "Known pitfalls" already documents the untagged-project gotcha this story fixes for `apps/web`.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/project.json` `tags`, `eslint.config.mjs` -- tag `apps/web` `scope:web`, add matching depConstraints entry (`scope:web` → `scope:web`, `scope:shared`) -- unblocks `apps/web` importing from `libs/`.
- [x] `apps/api/src/main.ts`, `apps/web/.env.example`, `.env.example` -- move `apps/api`'s default port to 3333; add `API_BASE_URL` (default `http://localhost:3333/api`) read by `apps/web` -- fixes the port collision, makes cross-app calls configurable.
- [x] `libs/shared/src/lib/paper-summary.ts` -- shared `PaperSummary` type (`paperNumber`, `title`, `authors: string[]`) -- single source of truth for the response shape.
- [x] `libs/database/src/lib/paper-browse.repository.ts` (or similar) -- read-only query returning all papers with author names, sorted by `paperNumber` -- reuses Story 1.2's entities.
- [x] `apps/api/src/app/papers/` (module, controller, service) -- `GET /api/papers` returning `PaperSummary[]` -- fulfills the backend half of the AC.
- [x] `apps/web` -- Tailwind CSS + shadcn/ui setup (init, base config, a couple of primitives needed for the list/links) -- resolves the deferred Story 1.1 item.
- [x] `apps/web/src/app/page.tsx` (or a dedicated route) -- header/subtitle, fetches `PaperSummary[]` from `apps/api`, renders the list, each row links to `/papers/[paperNumber]` -- fulfills the frontend half of the AC.

**Acceptance Criteria:**
- Given all ingested papers, when I open the Browse Papers view, then exactly that many entries are listed, each showing paper number, title, and author(s) (UX-DR7).
- Given the Browse Papers view, then the page matches the two-column-aesthetic visual language (academic, not ChatGPT-clone) and shows the "Federalist Research" header/subtitle (UX-DR1, UX-DR2, UX-DR3).
- Given a paper entry, when I click it, then it links to that paper's reader-view route.

## Spec Change Log

- 2026-08-25 -- Amended the frozen Boundaries text: the env var apps/web reads for the API base URL was originally specified as `NEXT_PUBLIC_API_BASE_URL`. Code review (patch #3) correctly caught that this is the wrong kind of env var -- `NEXT_PUBLIC_` specifically means "inline into the client bundle," but the value is only ever read inside an async Server Component that never runs in the browser. This was a spec-drafting mistake (mine), not an implementation deviation -- the implementing agent applied the fix but correctly declined to silently edit the frozen block itself, flagging the conflict instead. Renamed to `API_BASE_URL` (no prefix) in both the Boundaries text and the implementation. KEEP: the default value (`http://localhost:3333/api`) and its purpose (fixing the apps/api/apps/web port collision) are unchanged, only the variable name.
- 2026-08-25 -- Code review patch round (12 `patch`-classified findings, all fixed, no other spec-intent change): (1) `apps/web/tsconfig.json`'s `paths` override was silently dropping the other lib aliases (TS `extends` replaces `paths`, doesn't merge) -- fixed by explicitly repeating all base aliases. (2) Removed the unused `lucide-react` dependency. (3) See the env-var rename above. (4) Trailing slash now stripped from the configured base URL before appending `/papers`. (5) The fetch-failure catch block now logs server-side before setting the error state. (6) Added `papers.http.spec.ts` -- boots the real controller/service/global-prefix wiring over a real HTTP request, closing the "nothing tests the actual route" gap. (7) Added `paper-browse.repository.spec.ts` -- a DB-free unit test feeding reverse-order authors, which would fail if the alphabetical `.sort()` were ever deleted (the only previous test covering this was DB-gated and skipped by default, and the unit test's fixture was already pre-sorted, masking the gap entirely). (8) `apps/web/specs/index.spec.tsx` now asserts the actual fetch URL/options, not just canned response handling. (9) `apps/api/src/main.ts`'s `PORT` parsing now validates via a new `parsePort()` (matching Story 1.2's `parseIntEnv` pattern) instead of accepting any truthy string; `main.ts` also gained a `require.main === module` guard so it can be imported by its own test without a real bootstrap attempt. (10) Added a 5s `AbortSignal.timeout` to the apps/web -> apps/api fetch call. (11) `fetchPapers()` now rejects a non-array 2xx body as a fetch failure; per-item author rendering guards against a missing/non-array `authors` field with an "Unknown author" fallback. (12) Renamed the misleadingly-named `mockFetchResolvedOnce` test helper to `mockFetchResolved`.

## Design Notes

`PaperSummary` is a plain shared TypeScript type, not a Zod-validated schema — AD-9's shared-schema rule is explicitly scoped to the `Answer`/`Citation` contract and the ingestion chunk DTOs; this endpoint returns backend-controlled data (not user input, not LLM output), so a shared type gives the "no drift between apps" benefit AD-9 is after without the runtime-validation overhead that matters more for genuinely uncertain data. Revisit if this endpoint ever takes user-supplied filters.

The Browse Papers page intentionally does not implement the two-column layout shell (UX-DR1) — there's no second column's worth of content until Epic 3's Ask-the-Archive exists. It shares the same header/typography/color language so it feels like the same app, not a preview of the eventual split-screen layout.

## Verification

**Commands:**
- `npm run dev` (both apps together) -- expected: both `apps/api` (port 3333) and `apps/web` start without a port collision.
- `curl http://localhost:3333/api/papers` -- expected: JSON array of all currently-ingested papers with correct number/title/author(s).
- Open the Browse Papers page in a browser against the real, already-ingested DB -- expected: every real paper listed, joint-authorship papers (18–20, 62–63) show all credited authors.
- `nx run-many -t lint,test` -- expected: exit 0.

## Suggested Review Order

**Entry point**

- `BrowsePapersPage` fetches `PaperSummary[]` from `apps/api` and renders the header/subtitle/list — the frontend half of this story in one place.
  [`page.tsx:24`](../../apps/web/src/app/page.tsx#L24)

**Cross-app HTTP wiring (new this story)**

- `apps/api`'s default port moves off the same default Next.js uses, closing a collision neither app had ever actually hit before this story.
  [`main.ts:18`](../../apps/api/src/main.ts#L18)

- Base URL is stripped of a trailing slash and given a 5s timeout before the request — a raw string concatenation would have silently doubled a slash or hung indefinitely.
  [`page.tsx:28`](../../apps/web/src/app/page.tsx#L28)

- `apps/web` tagged `scope:web`, restricted to `scope:web`/`scope:shared` — the same "untagged project is fully blocked" fix `apps/api` needed in Story 1.2.
  [`eslint.config.mjs:63`](../../eslint.config.mjs#L63)

**Deterministic author ordering (the review-caught test gap)**

- Alphabetical sort, with a unit test that would actually fail if it were deleted — the only prior coverage used pre-sorted fixture data and masked this exact regression.
  [`paper-browse.repository.ts:21`](../../libs/database/src/lib/paper-browse.repository.ts#L21)

**Real HTTP-path coverage (closes the "only unit-tested with fakes" gap)**

- Boots the real controller/service/global-prefix wiring over an actual HTTP request, not a fake.
  [`papers.http.spec.ts`](../../apps/api/src/app/papers/papers.http.spec.ts)

**Peripherals**

- `parsePort` -- fail-fast `PORT` validation matching Story 1.2's `parseIntEnv` pattern, plus the `require.main === module` guard that makes `main.ts` importable by its own test.
  [`main.ts:18`](../../apps/api/src/main.ts#L18)
- `PaperSummary` -- the shared type both apps import, matching the architecture diagram's `web → shared` edge.
  [`paper-summary.ts`](../../libs/shared/src/lib/paper-summary.ts)
