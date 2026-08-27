---
title: 'Story 2.2: Search by Semantic Concept'
type: 'feature'
created: '2026-08-26'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '7c369cb46084fb1f0dd739b4d79acd264740fff1'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 2.1 finds a paper only if you already know its number, an author, or exact wording. A researcher who only has a rough idea of a concept ("how does the government check itself?") and doesn't know the 18th-century phrasing has no way to find it.

**Approach:** Implement `libs/retrieval`'s `retrieveRelevantChunks`: embed the query via `libs/ai`, run a pgvector cosine-similarity search against `libs/database`'s `document_chunks`, and return the top-K chunks with their similarity scores -- no confidence-threshold interpretation, that's Epic 3's job. Expose it through a directly-curlable `apps/api` endpoint for manual verification, and prove it actually works via a hand-built retrieval evaluation dataset and script. No new frontend page in this story -- Epic 3's Ask-the-Archive page is the real consumer-facing surface for semantic search; building UI for it here would just repeat Story 2.1's wiring pattern for something with no user-facing consumer yet.

## Boundaries & Constraints

**Always:**
- `retrieveRelevantChunks(dataSource, aiProvider, query, options)` in `libs/retrieval`: embeds `query` via `aiProvider.generateEmbedding`, queries `document_chunks.embedding` (pgvector) using the cosine-distance operator (`<=>`), and returns the top `options.topK` (default 5) results ordered by similarity -- `score = 1 - distance` (higher is more similar), never a raw distance. Each result carries `chunkId`, `paperNumber`, `paperTitle`, `content`, and `score`.
- `options.paperNumber` (exact) and `options.author` (case-insensitive substring, same convention as Story 2.1's author match) each filter in the SQL `WHERE` clause *before* the `LIMIT topK` -- never applied post-hoc to an already-limited result set (AD-7, NFR6). A query combined with a filter that only one low-similarity chunk satisfies must still return that chunk, not an empty/wrong result because a higher-similarity, non-matching chunk took its slot in an unfiltered top-K.
- Retrieval returns scores only -- no "confident"/"clarify"/"refuse" tiering or any other confidence interpretation (`decisions.md`'s "Confidence tiering" is Epic 3's orchestrator, not this story).
- `libs/retrieval` depends only on `libs/database` (the pgvector read) and `libs/ai` (query embedding) -- never a vendor AI SDK directly, never `libs/documents`.
- `apps/api` gains `GET /api/papers/search/semantic?q=<query>&topK=<n>&paperNumber=<n>&author=<name>` on the existing `PapersController`/`PapersModule`, returning `RetrievedChunk[]`. Pure pass-through to `retrieveRelevantChunks` -- no orchestration, generation, or citation logic.
- `eslint.config.mjs`'s `depConstraints` for `scope:api` gains `scope:retrieval` to its `onlyDependOnLibsWithTags` list -- it isn't there today, and this story is the first time `apps/api` needs it.
- A hand-built retrieval evaluation dataset (question -> `expectedPapers` array, `testing-approach.md`'s shape) plus a script that embeds each question, retrieves the top-K, and reports whether each question's expected paper(s) appear in the results -- wired as an `nx run api:eval-retrieval` target / `npm run eval:retrieval` script, mirroring the existing `ingest:federalist-papers` convention. This script calls the real embedding model (like `ingest:federalist-papers` does) and is a deliberately separate, manually-run verification step -- it does not run as part of `nx run-many -t test`.
- Automated tests for `retrieveRelevantChunks`'s SQL correctness (ordering, filter-before-limit) use real Postgres+pgvector with hand-crafted, deterministic embedding vectors -- not real Gemini calls -- so correctness is provable without consuming API quota. Only the eval script itself calls the real embedding model.

**Ask First:** Any dependency, tool, or Nx workspace flag not already named in `stack.md` / the architecture spine / this spec.

**Never:**
- Confidence-threshold/tiering logic, citation logic, or LLM answer generation (Epic 3).
- Hybrid (keyword + semantic combined) search -- optional per the AC, not required, and out of scope for this story.
- A new frontend page or UI for semantic search (this story's scope call) -- Epic 3 builds the real user-facing surface.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Semantic query, no filters | e.g. "how does government check itself?" | Top-K chunks ordered by similarity score, each with a score | N/A |
| Semantic query + `paperNumber` filter | Query plus a specific paper number | Only that paper's chunks considered, filter applied before the top-K limit | N/A |
| Semantic query + `author` filter | Query plus an author name | Only that author's (incl. joint-authorship) chunks considered, filter applied before the top-K limit | N/A |
| Eval script run | The hand-built dataset | Each question's expected paper(s) appear among its top-K results; script exits non-zero on any miss | N/A |
| Empty/whitespace query | `q` blank or absent | Empty results, not an error | Never a crash |
| Embedding call fails (e.g. missing `GEMINI_API_KEY`, provider error) | N/A | Endpoint returns a clear error response | Never a hang or an unhandled crash |

</frozen-after-approval>

## Code Map

- `docs/planning/epics.md` (Story 2.2 AC), `docs/implementation/epic-2-context.md` -- Epic 2 context: the `retrieveRelevantChunks(query, options)` conceptual signature, the filter-before-limit requirement, and "no confidence-threshold interpretation" already locked in for this story specifically.
- `docs/planning/specs/spec-federalist-research/decisions.md` ("Confidence tiering") -- confirms threshold interpretation is explicitly Epic 3's orchestrator, not this story's.
- `docs/planning/specs/spec-federalist-research/testing-approach.md` -- the retrieval evaluation dataset's shape (question -> `expectedPapers`) and purpose.
- **Proven reference implementation:** commit `9d1ae94` ("Story 0.1 spike: prove the RAG pipeline end-to-end") -- never merged, but `spike/src/db.ts`'s `retrieveRelevantChunks` (`git show 9d1ae94:spike/src/db.ts`) proves the exact pgvector query shape (`ORDER BY embedding <=> $1`, `score = 1 - (embedding <=> $1)`) against real Gemini embeddings, and `spike/src/eval.ts` / `spike/eval-dataset.json` (`git show 9d1ae94:spike/src/eval.ts`, `git show 9d1ae94:spike/eval-dataset.json`) prove the eval script's shape. This story rebuilds the same concepts against the real `libs/` boundaries, per that spike's own recommendation -- not a copy-paste, but a checked reference for the query/eval mechanics.
- `libs/retrieval/src/lib/retrieval.ts` -- currently an unused Nx-generator stub (a trivial `retrieval()` function, no real call sites anywhere) -- replace entirely.
- `libs/database/src/lib/entities/document-chunk.entity.ts` -- `document_chunks.embedding` is a native `vector(3072)` pgvector column (Story 1.2); this is the first story to query it.
- `libs/ai/src/lib/ai-provider.interface.ts`, `ai-provider.factory.ts` -- `generateEmbedding` and `createAIProvider()`; `apps/api/src/ingest.ts` shows the existing factory-injection pattern (`createAIProvider()` called once, passed as a parameter) to mirror for wiring an `AIProvider` into `PapersModule`'s DI graph for the first time.
- `docs/implementation/spec-2-1-search-by-metadata.md` (status: done) -- prior story continuity: `apps/api/src/app/papers/papers.controller.ts`/`papers.service.ts`/`papers.module.ts` to extend (not replace), and the case-insensitive author-substring-match convention (`paper-search.repository.ts`) to reuse for this story's `author` filter.
- `eslint.config.mjs` -- `scope:api`'s `onlyDependOnLibsWithTags` (around line 52) needs `scope:retrieval` added; `scope:retrieval`'s own constraint already permits `scope:database`/`scope:ai`/`scope:shared` (no change needed there).
- `apps/api/project.json` (`build-ingest`/`ingest` targets), `apps/api/webpack.ingest.config.js`, `package.json`'s `ingest:federalist-papers` script -- the exact pattern (a dedicated webpack config plus a `build-X`/`X` Nx target pair, wired to an `npm run` script) to mirror for `eval-retrieval`.

## Tasks & Acceptance

**Execution:**
- [ ] `eslint.config.mjs` -- add `scope:retrieval` to `scope:api`'s `onlyDependOnLibsWithTags`.
- [ ] `libs/retrieval/src/lib/retrieval.ts` -- replace the stub with `retrieveRelevantChunks(dataSource, aiProvider, query, options)`, `RetrievedChunk`, and `RetrieveOptions` types.
- [ ] `apps/api/src/app/papers/` -- wire an `AIProvider` into `PapersModule`'s DI graph (factory provider using `createAIProvider()`), extend `PapersController`/`PapersService` with `GET /api/papers/search/semantic`.
- [ ] `apps/api/src/retrieval-eval-dataset.json` -- hand-built question -> `expectedPapers` dataset (at least 6 cases, including one multi-expected-paper case).
- [ ] `apps/api/src/eval-retrieval.ts` -- eval script: embed each question for real, retrieve top-K, report hits/misses, non-zero exit on any miss.
- [ ] `apps/api/project.json`, `apps/api/webpack.eval-retrieval.config.js`, `package.json` -- `build-eval-retrieval`/`eval-retrieval` Nx targets and an `eval:retrieval` npm script.

**Acceptance Criteria:**
- Given all 85 papers have been ingested with embeddings, when I search using a semantic query, then `libs/retrieval` embeds the query and returns the top-K most similar chunks via pgvector similarity search, each with its similarity score.
- Retrieval applies no confidence-threshold logic of its own -- it returns scores, nothing more.
- When a semantic search is combined with a `paperNumber` or `author` filter, then that filter applies in the SQL `WHERE` clause before the top-K `LIMIT`, never post-hoc.
- Running the retrieval evaluation script against the sample eval dataset shows each question's expected paper appearing in its top-K results.

## Spec Change Log

- 2026-08-26 -- Code review patch round (7 findings across 3 independent reviewers, all fixed, no spec-intent change): (1) `runEval` had no per-case error handling -- one rejected retrieval aborted the whole run and discarded every other question's result; fixed with a per-case try/catch (mirroring `ingest.ts`'s `runIngestion` continue-past-failure convention), recording a failed case as a miss with its error captured, verified by a test where one case rejects and a later case still succeeds. (2) The eval script made one real embedding call per question with no delay, unlike `ingest.ts`'s `INGEST_EMBED_DELAY_MS` precaution against Gemini's rate limit -- fixed with an `EVAL_EMBED_DELAY_MS`-configurable delay (default 250ms) before every real call after the first. (3) **The most important finding**: 6 of the hand-built eval dataset's 8 questions named the target paper directly in the question text ("What does Federalist No. 10 say...") -- this tested keyword matching, not the semantic/conceptual retrieval this story exists to prove. Rewritten so every question describes the concept/argument in plain language with no paper number anywhere in the text -- re-verified with a real run against live Gemini embeddings and the real corpus: all 8 questions found their expected paper in the top-5 (see Verification below for the actual scores/results). (4) No upper bound on `topK` (`?topK=999999` reached the SQL `LIMIT` unbounded) -- fixed with a clamp at 50. (5) Malformed `paperNumber` had no test (only `topK`'s malformed-value coverage existed) -- added the missing case. (6) `ORDER BY` had no deterministic tiebreaker for equal-similarity ties -- added `chunk.id` as a secondary sort key, confirmed it doesn't disturb the halfvec/HNSW index match. (7) `RetrievedChunk.score`'s doc comment didn't state it can be negative (`1 - cosine_distance`, not a bounded `[0,1]` confidence value) -- doc comment corrected, pinned with a test. Six additional lower-value findings (pgvector HNSW approximate-search correctness under filters at real-corpus scale, no configurable/persisted eval tooling for future threshold sweeps, no embedding-shape validation, no rate limiting on the new endpoint until Epic 4, the lazy AI-provider wrapper's memoization being race-safe only because `createAIProvider()` is currently synchronous, no call timeouts) were deferred rather than patched -- logged to `docs/implementation/deferred-work.md`. Re-verified after all fixes: full `nx run-many -t lint,test` and `npm run test:db-integration` both pass (19 retrieval-project DB-integration tests), plus the real `npm run eval:retrieval` run described above.

## Design Notes

## Verification

**Commands:**
- `curl "http://localhost:3333/api/papers/search/semantic?q=how+does+government+check+itself&topK=5"` -- expected: 5 chunks with descending similarity scores.
- `curl "http://localhost:3333/api/papers/search/semantic?q=executive+power&paperNumber=70"` -- expected: only paper 70's chunks.
- `npm run eval:retrieval` -- expected: every dataset question's expected paper appears in its top-K, exit 0. **Actually run** against real Gemini embeddings and the real 85-paper corpus: all 8 questions hit, e.g. "Why would a government still need internal checks and balances between its branches even if the people running it were as virtuous as angels?" (no paper number named) correctly retrieved paper 51 first (score 0.7425); "Why does Publius argue for one strong president instead of a council or committee running the executive branch?" retrieved paper 70 (score 0.7648), one of the 11 valid targets. `EVAL PASSED: all 8 questions found an expected paper in the top-5`.
- `nx run-many -t lint,test` -- expected: exit 0.
- `npm run test:db-integration` -- expected: exit 0, including the new pgvector-ordering/filter-before-limit proof (19 tests in the `retrieval` project).

## Suggested Review Order

**Entry point**

- `retrieveRelevantChunks` -- embeds the query, builds the parameterized pgvector query (score expression, optional filters, LIMIT), maps rows back to `RetrievedChunk[]`.
  [`retrieval.ts:79`](../../libs/retrieval/src/lib/retrieval.ts#L79)

**Correctness the story's Boundaries actually hinge on (filter-before-limit, HNSW index match)**

- `COSINE_DISTANCE_EXPRESSION` -- casts to `halfvec(3072)` to match the HNSW index the migration built; getting this wrong wouldn't break correctness, only silently fall back to a full scan.
  [`retrieval.ts:44`](../../libs/retrieval/src/lib/retrieval.ts#L44)

- The `paperNumber`/`author` `WHERE` fragments, built into the *same* query as the `LIMIT` -- this is what makes filter-before-limit true by construction rather than by convention.
  [`retrieval.ts:103`](../../libs/retrieval/src/lib/retrieval.ts#L103)

- `retrieval.integration.spec.ts`'s load-bearing proof: decoy chunks pinned to cosine similarity 1.0 fill an unfiltered top-K, excluding a target pinned to similarity 0 -- then the same target *is* returned once filtered, proving the WHERE clause narrowed the candidate set before the LIMIT ran, not after.
  [`retrieval.integration.spec.ts:241`](../../libs/retrieval/src/lib/retrieval.integration.spec.ts#L241)

**The review-caught headline issue (a weak eval dataset)**

- `retrieval-eval-dataset.json` -- rewritten after review caught 6 of 8 questions naming their target paper directly in the question text, which tested keyword matching instead of the semantic retrieval this story exists to prove.
  [`retrieval-eval-dataset.json:1`](../../apps/api/src/retrieval-eval-dataset.json#L1)

- `runEval`'s per-case try/catch and `withEmbedDelay` -- also review-caught: one failed question no longer aborts the whole run, and real embedding calls no longer fire back-to-back into Gemini's rate limit.
  [`eval-retrieval.ts:71`](../../apps/api/src/eval-retrieval.ts#L71)

**API wiring**

- `PapersController.searchSemantic` / `parsePositiveIntQueryParam` -- strict, never-crashing query-param parsing; `topK` is clamped at 50 (also review-caught) rather than left unbounded.
  [`papers.controller.ts:104`](../../apps/api/src/app/papers/papers.controller.ts#L104)

- `createAIProviderProvider` -- a lazy, memoizing DI wrapper so a missing `GEMINI_API_KEY` only breaks `GET /api/papers/search/semantic`, never the whole `apps/api` server at boot.
  [`ai-provider.provider.ts:27`](../../apps/api/src/app/papers/ai-provider.provider.ts#L27)

**Peripherals**

- `eslint.config.mjs` -- `scope:api` gains `scope:retrieval`, the first time `apps/api` is allowed to depend on it.
  [`eslint.config.mjs:59`](../../eslint.config.mjs#L59)

- `libs/database`'s `escapeLikeTerm`, exported so `libs/retrieval`'s `author` filter reuses Story 2.1's exact ILIKE-escaping convention instead of duplicating it.
  [`paper-search.repository.ts:78`](../../libs/database/src/lib/paper-search.repository.ts#L78)
