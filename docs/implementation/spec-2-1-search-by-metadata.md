---
title: 'Story 2.1: Search by Number, Author, Title, or Keyword'
type: 'feature'
created: '2026-08-26'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '29594c2b3acd451276288d9f48ba4f117639ddb5'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** There's no way to find a specific paper without scrolling the full Browse list. Epic 2's search capability is Epic 1's next natural step — a researcher who already has some idea what they're looking for (a number, an author, a phrase) should be able to jump straight to it.

**Approach:** Add a `GET /api/papers/search` endpoint doing a direct relational query (number/author/title/keyword — no embeddings, no `libs/retrieval`), and a self-contained "Quick find" search component on the Browse Papers page, with the search term carried in the URL (not client-side state) so the Paper Reader page can show a context-aware "back to your search" link.

## Boundaries & Constraints

**Always:**
- If the query is a plain decimal integer (reuse `parsePaperNumberRouteSegment`'s validation from `libs/shared`), search by exact `paperNumber` match.
- Otherwise, match papers where the query is a case-insensitive substring of an author's name, the paper's title, or the paper's full text (`ILIKE`) — matching papers are returned via a direct query against `libs/database`; no embeddings, no `libs/retrieval` involvement, no separate search database.
- Author search must correctly surface joint/disputed authorship: searching "Madison" returns his solely-authored papers plus Nos. 18–20 and the disputed 62–63.
- Each matching paper appears exactly once in the results, regardless of how many fields/authors it matched on.
- The search endpoint returns `PaperSummary[]` (Story 1.3's existing shared type) — no new shared type needed.
- `QuickFindSearch` is a self-contained `'use client'` component: its own input state (`useState`), no props required, no global store. Submitting navigates to `/?q=<term>` (Next.js's own URL-based routing) rather than holding search state in memory.
- The Browse Papers page reads `searchParams.q`: if present and non-empty, fetches from the search endpoint and shows "Search results for '<term>'" plus a way back to the unfiltered list; if absent, behaves exactly as it does today (Story 1.3, unchanged).
- Every paper link rendered from a search result carries the current `?q=` forward (e.g. `/papers/51?q=Madison`), so the Reader page can read it back.
- The Paper Reader page reads an optional `searchParams.q`: when present, its back-link reads "← Back to results for '<term>'" (linking to `/?q=<term>`) instead of the generic "← Browse Papers".
- This story adds the search UI to the Browse Papers page only — not the Reader page (a UX call, not a technical limitation; `QuickFindSearch` itself is portable to any page later with no changes).

**Ask First:** Any dependency, tool, or Nx workspace flag not already named in `stack.md` / the architecture spine / this spec.

**Never:**
- Implement semantic/vector search (Story 2.2) or any Ask-the-Archive behavior (Epic 3).
- Introduce a client-side state management library (MobX, Redux, Zustand, etc.) — this story's state is either local component state or URL params, nothing that needs one.
- Introduce a separate search database or full-text-search infrastructure beyond plain `ILIKE` queries.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Search by number | `q=51` | Exactly paper 51 returned | N/A |
| Search by author (joint authorship) | `q=Madison` | His solely-authored papers plus Nos. 18–20 and 62–63, every one exactly once | N/A |
| Search by title/keyword | `q=<phrase found in a paper's title or body>` | Every paper containing that phrase in title or full text, case-insensitive | N/A |
| No matches | `q=<nonsense string>` | Empty results array/list, not an error | N/A |
| Empty/whitespace query | Search box submitted empty, or `q` absent from the URL | Browse page shows the full unfiltered list (today's Story 1.3 behavior) — never treated as "search for nothing, find nothing" | N/A |
| Navigating from a search result to the Reader | Click a paper from filtered results | Reader's back-link reads "back to results for '<term>'", not a generic Browse link | N/A |

</frozen-after-approval>

## Code Map

- `docs/planning/epics.md` (Story 2.1 AC), `docs/implementation/epic-2-context.md` -- Epic 2 context (many-to-many `Author` handling, "no embeddings/no `libs/retrieval`" constraint already established for this story specifically).
- `docs/planning/specs/spec-federalist-research/SPEC.md` (Non-goals: no separate search database) -- already-locked constraint this story must respect.
- `docs/implementation/spec-1-3-browse-all-papers.md`, `docs/implementation/spec-1-4-read-a-paper.md` (status: done) -- prior story continuity: `PaperSummary` type (reused as-is for search results), the `apps/api/src/app/papers/` controller/service/module pattern to extend, `apps/web/src/lib/api-client.ts`'s `resolveApiBaseUrl`/`API_FETCH_TIMEOUT_MS` (reused, not re-duplicated) for the new search fetch, `libs/shared/src/lib/paper-number-route-segment.ts`'s `parsePaperNumberRouteSegment` (reused for "is this query a plain integer" detection).
- `libs/database/src/lib/paper-browse.repository.ts` -- existing browse-all query pattern (alphabetical author ordering, entity relations) this story's new search repository method should follow.
- `apps/web/src/app/page.tsx`, `apps/web/src/app/papers/[paperNumber]/page.tsx` -- both need to read `searchParams` per Next.js App Router's page-prop convention; neither currently does.

## Tasks & Acceptance

**Execution:**
- [ ] `libs/database/src/lib/paper-search.repository.ts` -- `searchPapers(query: string)`: exact `paperNumber` match if the query is a plain integer, else a deduped `ILIKE` match across author name / title / full text.
- [ ] `apps/api/src/app/papers/` -- extend with `GET /api/papers/search?q=<term>` returning `PaperSummary[]`.
- [ ] `apps/web/src/components/quick-find-search.tsx` -- `QuickFindSearch`, self-contained client component, submits by navigating to `/?q=<term>`.
- [ ] `apps/web/src/app/page.tsx` -- accept `searchParams`, branch between the existing browse-all fetch and the new search fetch based on `q`, render `QuickFindSearch`, show "Search results for '<term>'" + a clear-search link when a search is active, carry `?q=` forward on every result's paper link.
- [ ] `apps/web/src/app/papers/[paperNumber]/page.tsx` -- accept `searchParams`, render a context-aware back-link when `q` is present.

**Acceptance Criteria:**
- Given all 85 papers have been ingested, when I search by paper number, then I get the exact matching paper.
- When I search by author name, then I get all papers by that author, correctly including jointly-authored papers.
- When I search by title text or an exact keyword found in a paper's body, then matching papers are returned via a direct query against `libs/database` — no embeddings, no `libs/retrieval` involvement, no separate search database.

## Spec Change Log

- 2026-08-26 -- Code review patch round (4 findings across 3 independent reviewers, all fixed, no spec-intent change): (1) A repeated `?q=a&q=b` resolved to `string[]` under Nest/Express and reached `searchPapers`'s `query.trim()` unchanged, throwing an unhandled 500 -- fixed by normalizing to the first value in the controller (the same pattern `apps/web`'s page already used for its own `searchParams.q`), verified with a new real-HTTP test. (2) `ILIKE`'s `%`/`_`/`\` were not escaped in `findByKeyword`, so a literal `%` or `_` in a search term was interpreted as a SQL wildcard instead of matched literally -- fixed with an `escapeLikeTerm` helper, verified with a unit test on the constructed pattern plus an integration test proving a literal-`%` fixture matches while a wildcard-decoy fixture doesn't. (3) The Browse Papers page's search-result description showed "No results for 'X'." even when the real cause was an unreachable `apps/api` (with `ApiUnreachableNotice` rendering right below it) -- fixed by checking `hasError` first, independent of the "no matches" case, so no false claim renders when the API call itself failed. (4) The search endpoint's keyword-matching path (as opposed to its plain-integer path) was never proven through Nest's real HTTP routing, only through lower-level unit/integration specs -- `papers.http.spec.ts`'s faked repository gained a `createQueryBuilder` mock and a new real-HTTP test for a keyword query. Re-verified after all fixes: full `nx run-many -t lint,test` and `npm run test:db-integration` both pass (29 DB-integration tests, up from 27). Four additional real-but-lower-value findings (no `?q=` prefill in `QuickFindSearch`, an apostrophe in a query garbling the quoted label text, a numeric-but-nonexistent/negative query never falling back to keyword search, and the two-round-trip keyword query) were deferred rather than patched -- logged to `docs/implementation/deferred-work.md`.

## Design Notes

Search state lives in the URL (`?q=`), never in a client-side store or React context — this was a deliberate call, not an oversight: it's simpler, survives a refresh/back-button/shared link for free, and is exactly the mechanism that lets the Reader page's back-link know what you searched for without any component holding onto that state in memory.

`QuickFindSearch` takes no props today because it only needs to update the current page's own `q` param. If a future page wants it to search into a *different* route (rather than its own), that's a small, additive change then — not something to speculatively build now.

## Verification

**Commands:**
- `curl http://localhost:3333/api/papers/search?q=51` -- expected: exactly paper 51.
- `curl http://localhost:3333/api/papers/search?q=Madison` -- expected: his papers plus 18–20 and 62–63.
- `curl http://localhost:3333/api/papers/search?q=<nonsense>` -- expected: empty array.
- Open `/?q=Madison` in a browser against the real 85-paper DB -- expected: filtered list, each result linking to `/papers/N?q=Madison`.
- Open `/papers/51?q=Madison` -- expected: back-link reads "back to results for 'Madison'".
- `nx run-many -t lint,test` -- expected: exit 0.

## Suggested Review Order

**Entry point**

- `BrowsePapersPage` -- branches between the browse-all and search fetch, renders `QuickFindSearch`, and forwards `?q=` on every result link.
  [`page.tsx:50`](../../apps/web/src/app/page.tsx#L50)

**Search correctness (number vs. keyword, joint authorship, dedup)**

- `searchPapers` -- exact-number branch vs. keyword branch, plus the final author-name/paperNumber sort.
  [`paper-search.repository.ts:29`](../../libs/database/src/lib/paper-search.repository.ts#L29)

- `findByKeyword` -- the two-step ILIKE-then-rehydrate query that keeps every co-author attached and every match deduped.
  [`paper-search.repository.ts:79`](../../libs/database/src/lib/paper-search.repository.ts#L79)

**The review-caught headline bug (repeated `q` crashed the endpoint)**

- `PapersController.search` -- normalizes `string | string[]` to a single value before calling the service; without this, a repeated `?q=a&q=b` reached `.trim()` on an array and threw an unhandled 500.
  [`papers.controller.ts:41`](../../apps/api/src/app/papers/papers.controller.ts#L41)

**Also review-caught: unescaped ILIKE wildcards**

- `escapeLikeTerm` -- escapes `\`, `%`, `_` so a literal `%`/`_` in a search term is matched literally instead of read as a SQL wildcard.
  [`paper-search.repository.ts:75`](../../libs/database/src/lib/paper-search.repository.ts#L75)

**Also review-caught: misleading copy during a real API failure**

- The search `CardDescription` branch -- checks `hasError` first, independent of "no matches," so a real `apps/api` failure is never described as "no results."
  [`page.tsx:116`](../../apps/web/src/app/page.tsx#L116)

**Also review-caught: keyword path never proven through real HTTP routing**

- `fakeQueryBuilder` plus the new keyword-search test -- until this fake gained a `createQueryBuilder`, the search endpoint's two existing HTTP tests only proved the plain-integer branch wired up correctly.
  [`papers.http.spec.ts:129`](../../apps/api/src/app/papers/papers.http.spec.ts#L129)

**Reusable search component**

- `QuickFindSearch` -- self-contained, zero-prop client component; submits via a plain HTML GET form to `/`, no client router call, no global store.
  [`quick-find-search.tsx:19`](../../apps/web/src/components/quick-find-search.tsx#L19)

**Context-aware navigation (Reader page)**

- `PaperReaderPage` back-link -- reads `searchParams.q`, renders "Back to results for 'X'" instead of the generic Browse link when present.
  [`page.tsx:110`](../../apps/web/src/app/papers/%5BpaperNumber%5D/page.tsx#L110)

**Peripherals**

- `searchPapers` (Story 2.1 integration) -- the real-Postgres proof of the AC: number match, joint authorship, dedup on a double match, case-insensitive title match, full-text-only keyword match, no-match empty array, and the escaped-wildcard case added in the patch round.
  [`paper-search.repository.integration.spec.ts:29`](../../libs/database/src/lib/paper-search.repository.integration.spec.ts#L29)

- `QuickFindSearch` component spec -- renders/asserts controlled state, form method/action, input name, submit button.
  [`quick-find-search.spec.tsx:11`](../../apps/web/specs/components/quick-find-search.spec.tsx#L11)

- `libs/database` barrel export for the new repository.
  [`index.ts:8`](../../libs/database/src/index.ts#L8)
