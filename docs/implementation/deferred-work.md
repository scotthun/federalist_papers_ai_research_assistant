- source_spec: `docs/implementation/spec-1-1-nx-monorepo-setup.md`
  summary: Wire up Tailwind CSS + shadcn/ui in `apps/web` (currently plain CSS from the Nx generator default).
  evidence: `stack.md` names Tailwind CSS + shadcn/ui as the frontend styling stack, but Story 1.1's actual Acceptance Criteria never mentions styling and there's no real UI yet to style (the default Next.js scaffold page is untouched). Reasonable to defer to the first story that renders real UI (e.g. Story 1.3, Browse All Papers) rather than wire up styling infrastructure with nothing to apply it to.

- source_spec: `docs/implementation/spec-1-1-nx-monorepo-setup.md`
  summary: No automated (CI) check verifies Nx workspace-config target wiring, e.g. the `nx.json` `devTargetName: 'serve'` remap that makes `npm run dev` work for `apps/web`.
  evidence: This repo has no CI at all yet (no `.github` workflow, no other CI config). `nx run-many -t lint` / `-t test` don't exercise the `serve`/`dev` target mapping, so a future accidental removal of `devTargetName: 'serve'` would silently break `npm run dev` for `web` with no automated signal. Worth a lightweight check (e.g. `nx show project web --json` asserting a `serve` target exists) once CI is introduced — not this story's job to introduce CI itself.

- source_spec: `docs/implementation/spec-1-2-federalist-ingestion-pipeline.md`
  summary: `federalist_paper_authors` join table has no secondary index on `author_id` (only the composite PK `(paper_id, author_id)`), so the reverse `Author.papers` lookup direction isn't index-backed.
  evidence: Not needed by this story (ingestion only ever writes/looks up by `paperNumber`), but Epic 2 (search by author) will query the reverse direction. Cheap to add in a follow-up migration once that story starts.

- source_spec: `docs/implementation/spec-1-2-federalist-ingestion-pipeline.md`
  summary: The `ingest`/`migrate` one-off scripts have no graceful shutdown handling (SIGINT/SIGTERM) — `dataSource.destroy()` only runs via a `finally` block, so killing a long-running ingestion mid-run leaves the DB connection in an undefined state rather than closing cleanly.
  evidence: Real but low-value for a local one-off script (not a long-running server); worth revisiting if ingestion ever runs unattended/in CI where clean cancellation matters more.

- source_spec: `docs/implementation/spec-1-2-federalist-ingestion-pipeline.md`
  summary: `chunker.ts`'s `wordsOf('')` returns `['']` (one empty string) rather than `[]`, and overlap continuity is lost immediately after an oversized-paragraph hard-split fallback.
  evidence: Both are real per the code, but currently unreachable/unhit in practice — `wordsOf('')` is always called on already-guarded non-empty input, and none of the real 85 papers' paragraphs exceeded `maxWords` (1000 words) to trigger the oversized-paragraph fallback. Latent footguns worth fixing if `chunker.ts` is ever reused with different inputs/options.

- source_spec: `docs/implementation/spec-1-4-read-a-paper.md`
  summary: The Paper Reader route (`/papers/[paperNumber]`) has no `loading.tsx` and no per-page `generateMetadata`/title — every paper's browser tab shows the same generic app title, and a slow `apps/api` response leaves no loading feedback during the server-side fetch.
  evidence: Real gaps, not required by this story's AC (same call as Story 1.3's identical "no loading.tsx" finding). Worth adding once there's an actual perf/UX reason to prioritize it.

- source_spec: `docs/implementation/spec-1-4-read-a-paper.md`
  summary: No caching/revalidation strategy (`Cache-Control`, ETag, or Next.js ISR `revalidate`) for the Paper Reader page, even though ingested paper text is effectively immutable once stored.
  evidence: Every page view currently triggers a fresh `apps/web` → `apps/api` → Postgres round trip for content that never changes. Not a correctness issue, premature to optimize before there's real traffic.

- source_spec: `docs/implementation/spec-1-4-read-a-paper.md`
  summary: No browser-level (e.g. Playwright) test verifies the *visual* "quiet" placement of the verification link that `decisions.md`/UX-DR9 call for — current tests only confirm the link's existence and `href` via jsdom.
  evidence: Real gap, but this repo has no browser-test infrastructure at all yet; adding one is a much larger investment than this single finding justifies. Revisit if/when Playwright (or similar) is introduced for another reason.

- source_spec: `docs/implementation/spec-1-4-read-a-paper.md`
  summary: `paper-detail.repository.integration.spec.ts`'s `cleanUp` doesn't pre-assert the reserved test paper numbers are clean before the test body runs.
  evidence: Minor test-hygiene gap — if a previous run were killed mid-way, a stale row could cause a confusing failure instead of a clear "dirty fixture" signal. Low value to fix proactively without evidence this has actually happened.

- source_spec: `docs/implementation/spec-2-1-search-by-metadata.md`
  summary: `QuickFindSearch` never prefills from the current `?q=` — returning to `/?q=Madison` (browser back, a shared link, or the Reader page's own "Back to results for 'Madison'" link) renders an empty search box even though a search is active.
  evidence: Real gap, but the spec's own Design Notes explicitly call this out as a deliberate simplification ("QuickFindSearch takes no props today") — adding a prefill would mean either a prop (against that design note) or `useSearchParams()` (a Suspense-boundary complication) for a cosmetic benefit. Revisit only if the spec's no-props stance is deliberately renegotiated.

- source_spec: `docs/implementation/spec-2-1-search-by-metadata.md`
  summary: A search term containing an apostrophe garbles the single-quote-wrapped label text, e.g. `Search results for 'O'Brien'`.
  evidence: Real but cosmetic, and no real Federalist Papers author name contains an apostrophe (Hamilton, Madison, Jay) — low value to fix proactively for an input that can't occur against this corpus's actual data.

- source_spec: `docs/implementation/spec-2-1-search-by-metadata.md`
  summary: A purely numeric query (e.g. a year like "1787") that doesn't match any real `paperNumber` never falls back to keyword search against title/full text, even though the number might appear as a keyword in a paper's body; a negative number (e.g. "-5") behaves the same way.
  evidence: Matches the spec's own boundary verbatim ("If the query is a plain decimal integer... search by exact paperNumber match") — the number-path is exclusive by design, not a bug introduced by this story's implementation. Revisit only if the spec's search-mode boundary is deliberately renegotiated to add a keyword fallback.

- source_spec: `docs/implementation/spec-2-1-search-by-metadata.md`
  summary: `findByKeyword` performs two full round trips to Postgres per keyword search (one `getRawMany` for matching ids, then a second `find` by `In(ids)` to rehydrate authors) where a single query could suffice.
  evidence: Deliberate tradeoff, not an oversight — a single query with the match condition folded into the same `WHERE` would silently drop non-matching co-authors from the hydrated `authors` relation (the exact joint-authorship bug this story's boundaries exist to prevent). Harmless at the real 85-paper corpus; revisit only if this repository's scale changes enough for two round trips per search to matter.
