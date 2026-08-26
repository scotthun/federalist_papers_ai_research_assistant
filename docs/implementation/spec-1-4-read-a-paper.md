---
title: 'Story 1.4: Read a Paper with Source Verification'
type: 'feature'
created: '2026-08-25'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '0623ffd8eef33eef899408ffe2aa75748dccd492'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.3's Browse Papers list already links every row to `/papers/[paperNumber]`, but that route doesn't exist yet — it 404s. There's no way to actually read a paper's full text or verify it against its authoritative source.

**Approach:** Add a single-paper detail endpoint + shared type (extending Story 1.3's pattern), and build the Paper Reader page showing number/title/author(s)/full text plus a quiet source-verification link to the real Avalon Project page.

## Boundaries & Constraints

**Always:**
- Reader page shows paper number, title, author(s), and complete text (UX-DR8, partial — passage-in-context highlighting is Epic 3's job, not required here).
- A quiet "Source: Avalon Project ↗" tag appears near the paper title, linking to that paper's exact `sourceUrl` (UX-DR9, `decisions.md` "Verification link placement") — not inline per-passage, not in a drawer.
- The link opens the real Avalon Project page for that specific paper number — it must use the paper's actual stored `sourceUrl`, never a hardcoded or re-derived guess.
- `apps/api` exposes `GET /api/papers/:paperNumber` returning number/title/author(s)/full text/`sourceUrl`; `apps/web` consumes it over HTTP only (Structural Seed) — no direct DB access.
- `libs/database` gains a new read method for one paper by `paperNumber` (separate from Story 1.3's browse-list method), reusing the existing `FederalistPaper` entity.
- Response shape is a shared TypeScript type in `libs/shared`, composing Story 1.3's `PaperSummary` (`PaperSummary & { fullText: string; sourceUrl: string }`) rather than redeclaring its fields.
- Full text renders with paragraph breaks preserved (stored as `\n\n`-joined paragraphs by the Story 1.2 parser) — not one unbroken block of text.
- A nonexistent `paperNumber` renders a real 404 (Next.js `notFound()`), not a crash or blank page.

**Ask First:** Any dependency, tool, or Nx workspace flag not already named in `stack.md` / the architecture spine / this spec.

**Never:**
- Implement Ask-the-Archive, search, or citation/passage-in-context navigation (Epic 3).
- Implement any editing or annotation of paper text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid paper | e.g. `paperNumber=1` | Number, title, author(s), full text, and source tag all shown | N/A |
| Joint authorship | Papers 18–20, 62–63 | Every credited author shown, never an arbitrary single pick | N/A |
| Nonexistent paper number | e.g. `paperNumber=999` | Real 404 page | Never a crash or blank page |
| Non-numeric route segment | e.g. `/papers/abc` | Handled the same as "not found" | Never a crash |
| API unreachable | `apps/api` down or unreachable | Clear, visible error state (same pattern as Story 1.3's Browse page) | Fetch failure never renders blank/crashed |

</frozen-after-approval>

## Code Map

- `docs/planning/epics.md` (Story 1.4 AC, UX-DR8/UX-DR9), `docs/planning/specs/spec-federalist-research/decisions.md` ("Verification link placement" — exact quiet-tag wording and rationale for why it can only ever land at the top of the paper, not per-passage).
- `docs/planning/specs/spec-federalist-research/ui-design.md` (Paper Reader section, citation-navigation note — the latter is Epic 3's concern, not this story's).
- `docs/implementation/spec-1-3-browse-all-papers.md` (status: done) -- prior story continuity: `PaperSummary` type in `libs/shared`, the browse repository/controller/service pattern in `libs/database`/`apps/api/src/app/papers/` to replicate for the single-paper case, the existing `apps/web` → `apps/api` fetch/error-state pattern in `page.tsx` to reuse for the reader page.
- `libs/database/src/lib/entities/federalist-paper.entity.ts` -- already has `sourceUrl` and `fullText` columns (Story 1.2); this story is the first to actually read and display them.
- `apps/web/src/app/page.tsx` -- already links each row to `/papers/${paperNumber}`; this story is what makes that route real.

## Tasks & Acceptance

**Execution:**
- [x] `libs/shared/src/lib/paper-detail.ts` -- `PaperDetail` type (`PaperSummary & { fullText: string; sourceUrl: string }`) -- single source of truth for the response shape.
- [x] `libs/database/src/lib/paper-detail.repository.ts` (or similar) -- read-only query for one paper by `paperNumber`, including authors, returning `null` when not found.
- [x] `apps/api/src/app/papers/` -- extend with a `GET /api/papers/:paperNumber` route returning `PaperDetail` or a 404 when the repository returns `null`.
- [x] `apps/web/src/app/papers/[paperNumber]/page.tsx` -- fetch the paper detail, render number/title/author(s)/paragraphs, the quiet source tag linking to `sourceUrl`, `notFound()` on a missing paper, and the same clear-error-state pattern Story 1.3 established for an unreachable API.

**Acceptance Criteria:**
- Given a paper has been ingested, when I open its reader view, then I see the paper number, title, author(s), and complete text.
- Given the reader view, then a quiet "Source: Avalon Project ↗" tag appears near the paper title, linking to that paper's exact `sourceUrl`.
- Given that link, when clicked, then it opens the real Avalon Project page for that specific paper number, not a generic homepage.

## Spec Change Log

- 2026-08-25 -- Code review patch round (7 `patch`-classified findings, all fixed, no spec-intent change): (1) `Number()` + `Number.isInteger()` route-segment validation (both `apps/api`'s controller and `apps/web`'s page) silently accepted hex/exponential/decimal/`+`-prefixed lookalikes (`0x10`, `1e2`, `1.0`, `+1`) as valid paper numbers instead of 404ing -- fixed with a shared, regex-gated `parsePaperNumberRouteSegment` in `libs/shared`, verified live against all four lookalikes. (2) The `notFound()` tests only asserted a generic `.rejects.toThrow()`, which would have missed a regression to Next's generic error boundary -- now assert the actual not-found `.digest` signature, matching the stronger pattern already used one layer down in the API controller test. (3) `response.json()` was outside the try/catch wrapping `fetch()` -- a non-JSON 2xx body would have crashed the page; moved inside. (4) `isPaperDetail` now rejects `NaN`, non-string `authors` entries, and an empty `sourceUrl`. (5) `fullText.split('\n\n')` now filters empty/whitespace-only segments. (6) Added an `sr-only` "(opens in a new tab)" indication on the external source link. (7) Extracted `apps/web/src/lib/api-client.ts` and `apps/web/src/components/api-unreachable-notice.tsx` -- two independent reviewers flagged this story hand-duplicating Story 1.3's `page.tsx` base-URL/timeout/error-state logic; both pages now share one implementation instead of two copies. Re-verified after all fixes: full `nx run-many -t lint,test` and `npm run test:db-integration` both pass, plus a live check confirming all four numeric lookalikes now 404 correctly.

## Design Notes

`PaperDetail` composes `PaperSummary` rather than redeclaring `paperNumber`/`title`/`authors` — the two endpoints (list, detail) should never drift on what those three fields mean.

## Verification

**Commands:**
- `curl http://localhost:3333/api/papers/1` -- expected: JSON with number/title/authors/fullText/sourceUrl for paper 1.
- `curl http://localhost:3333/api/papers/999` -- expected: 404.
- Open `/papers/1` (and a joint-authorship paper, e.g. `/papers/51`) in a browser against the real 85-paper DB -- expected: full text renders with paragraph breaks, source tag links to the real Avalon page for that paper number.
- Open `/papers/999` in a browser -- expected: a real 404 page, not a crash.
- `nx run-many -t lint,test` -- expected: exit 0.

## Suggested Review Order

**Entry point**

- `PaperReaderPage` -- fetches, guards, and renders the whole story in one place.
  [`page.tsx:83`](../../apps/web/src/app/papers/%5BpaperNumber%5D/page.tsx#L83)

**The review-caught headline bug (lenient numeric parsing)**

- `parsePaperNumberRouteSegment` -- a plain `Number()` + `Number.isInteger()` check silently accepted `0x10`, `1e2`, `1.0`, and `+1` as valid paper lookups; this regex-gates the input first. Shared by both `apps/api` and `apps/web` so the fix (and the rule) lives once.
  [`paper-number-route-segment.ts:15`](../../libs/shared/src/lib/paper-number-route-segment.ts#L15)

**Verification tag (UX-DR9)**

- Quiet source link, `sourceUrl` used verbatim (never re-derived), with an accessible new-tab indication.
  [`page.tsx:152`](../../apps/web/src/app/papers/%5BpaperNumber%5D/page.tsx#L152)

**Fail-safe response handling (also review-caught)**

- `isPaperDetail` -- tightened to reject `NaN`, non-string author entries, and an empty `sourceUrl`; `response.json()` moved inside the same try/catch as the fetch itself so a non-JSON 2xx body can't crash the page.
  [`page.tsx:16`](../../apps/web/src/app/papers/%5BpaperNumber%5D/page.tsx#L16)

- The `notFound()` tests assert Next's actual not-found signature, not just "something threw" -- would have missed a regression to a generic error boundary otherwise.
  [`page.spec.tsx:20`](../../apps/web/specs/papers/paper-number/page.spec.tsx#L20)

**De-duplicated cross-app fetch plumbing (also review-caught, shared with Story 1.3)**

- `resolveApiBaseUrl`/`API_FETCH_TIMEOUT_MS`/`ApiUnreachableNotice` -- extracted after two independent reviewers flagged this story hand-duplicating Story 1.3's `page.tsx` logic; both pages now import the same module instead of each maintaining a copy.
  [`api-client.ts:23`](../../apps/web/src/lib/api-client.ts#L23)

**Peripherals**

- `findPaperDetailByNumber` -- the read-only repository method, alphabetical author ordering matching Story 1.3's pattern.
  [`paper-detail.repository.ts:24`](../../libs/database/src/lib/paper-detail.repository.ts#L24)
