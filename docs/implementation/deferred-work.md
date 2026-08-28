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

- source_spec: `docs/implementation/spec-2-2-search-by-semantic-concept.md`
  summary: pgvector's HNSW index is approximate (ANN), and a selective `paperNumber`/`author` WHERE filter combined with `ORDER BY ... LIMIT k` can under-return true top-K results unless iterative index scans are enabled — untested at real-corpus scale since the integration test's fixture tables are too small for Postgres to ever choose the ANN index path over a sequential scan.
  evidence: Real risk in principle, but proving/fixing it needs either a much larger synthetic fixture set or the real 85-paper embedded corpus, and no filtered-semantic-search precision issue has actually been observed yet. Revisit if a real filtered query is ever seen to miss an expected result, or once pgvector's `hnsw.iterative_scan` setting is evaluated.

- source_spec: `docs/implementation/spec-2-2-search-by-semantic-concept.md`
  summary: The eval script's `TOP_K` is a hardcoded constant, not configurable via env var, and its only output is unstructured `Logger.log` lines — no persisted, structured results artifact.
  evidence: `decisions.md`'s "Confidence tiering" section names this dataset/script as the intended mechanism to later sweep candidate threshold values, which in practice means varying `topK` too and comparing structured results across runs. Not needed by this story's own AC; revisit when Epic 3's confidence-threshold calibration work actually starts.

- source_spec: `docs/implementation/spec-2-2-search-by-semantic-concept.md`
  summary: `retrieveRelevantChunks` doesn't validate that the embedding returned by `aiProvider.generateEmbedding` is a well-formed, finite-number array of the expected dimension before building the pgvector query literal — a misbehaving provider would surface only as an opaque Postgres error.
  evidence: Matches this codebase's existing convention of trusting internal contracts at the lib layer rather than re-validating every interface boundary (same call already made for `topK`/`paperNumber` elsewhere); currently masked because `GeminiProvider` already validates its own output dimension. Revisit if a second `AIProvider` implementation ships without that guarantee.

- source_spec: `docs/implementation/spec-2-2-search-by-semantic-concept.md`
  summary: `GET /api/papers/search/semantic` is public, unauthenticated, and triggers a real metered Gemini embedding call on every request, with no rate limiting or cost-exposure guard.
  evidence: `decisions.md`'s "Rate limiting / cost exposure" section describes exactly this risk shape, but `epics.md` explicitly assigns the DB-backed limiter to Epic 4, not this story — this is an accepted, temporary gap per the project's own roadmap, not a defect introduced here. Worth flagging prominently until Epic 4 lands, since real API cost is exposed in the meantime.

- source_spec: `docs/implementation/spec-2-2-search-by-semantic-concept.md`
  summary: The lazy `AI_PROVIDER` DI wrapper's memoization (`ai-provider.provider.ts`) is only race-safe under concurrent requests because `createAIProvider()` is currently fully synchronous; no test proves it stays correct if that factory ever became async (e.g. an async secrets-manager lookup).
  evidence: Not a live bug today — verified the current synchronous construction can't race under `Promise.all`. Revisit only if `createAIProvider()` (or a future provider) gains a genuinely async construction step; a real in-flight-promise memoization pattern would be the fix then, not before.

- source_spec: `docs/implementation/spec-3-1-confident-answer-generation.md`
  summary: `POST /api/ask` is public, unauthenticated, and can trigger up to two real metered Gemini calls per request (the confident tier's one allowed retry) with no rate limiting or cost-exposure guard — the same accepted gap already logged for `GET /api/papers/search/semantic`, now applying to a materially more expensive (LLM generation, not just embedding) call.
  evidence: Same rationale as the semantic-search entry above: `epics.md` assigns the DB-backed limiter to Epic 4, not this story. Worth flagging more prominently than the embedding-only case, since a confident-tier request now costs up to 1 embedding + 2 generation calls instead of 1 embedding call.

- source_spec: `docs/implementation/spec-3-1-confident-answer-generation.md`
  summary: A confident-tier LLM-generation failure that isn't schema/citation-related (e.g. a transient Gemini outage or rate limit hit *after* the embedding call already succeeded) is indistinguishable, from `AskService`'s perspective, from a malformed/schema-invalid response — both enter the same one-retry-then-fail-safe path and surface as a 200 refuse-tier `Answer`, not a 500.
  evidence: A deliberate interpretation (documented in this spec's Design Notes) of two Boundaries rows that both target confident-tier LLM failures without fully disambiguating them; chosen because it satisfies the more specific "never an uncaught crash" retry policy and gives the end user an honest fallback answer instead of a raw error. Revisit if `libs/ai`'s `generateStructuredOutput` ever grows a typed error (e.g. a distinct `ProviderError` vs `SchemaValidationError`) that would let the orchestrator tell the two failure classes apart and treat a hard provider outage as a 500 instead.

- source_spec: `docs/implementation/spec-3-1-confident-answer-generation.md`
  summary: `CONFIDENT_THRESHOLD`/`CLARIFY_THRESHOLD` were calibrated against 8 on-topic and 7 off-topic control questions -- a small sample. Real user questions may include ones that are ambiguously worded, only tangentially related to the Federalist Papers, or adversarially phrased in ways this sample doesn't cover.
  evidence: `decisions.md` accepts this as the nature of empirical calibration ("no universal cosine-similarity cutoff exists"), not a defect. `npm run calibrate:thresholds` is kept as a real, re-runnable tool specifically so the thresholds can be revisited once real production question logs exist to calibrate against instead of a hand-built sample.

- source_spec: `docs/implementation/spec-3-1-confident-answer-generation.md`
  summary: No generation-config tuning (e.g. `temperature`) is set for the confident tier's LLM call in `GeminiProvider.generateStructuredOutput` -- sampling behavior is whatever Gemini's API default is, with no deliberate choice made or documented, despite this feature's whole premise being anti-hallucination.
  evidence: No observed hallucination/inconsistency problem motivating a specific value yet -- tuning without evidence of a real problem would be guessing. Revisit if live usage (or the eval/calibration scripts) surfaces inconsistent or overly-creative answers.

- source_spec: `docs/implementation/spec-3-1-confident-answer-generation.md`
  summary: No maximum length is enforced on the incoming `question` anywhere in the pipeline (`AskController`, the `apps/web` proxy route, or `AskQuestion`) -- an arbitrarily large string is embedded and placed into the LLM prompt uncapped.
  evidence: A narrower instance of the cost-exposure gap already logged above (`POST /api/ask` has no rate limiting until Epic 4) -- an unbounded question adds an unbounded-payload-size dimension to that same accepted, temporary gap rather than a new independent one. Revisit alongside Epic 4's rate limiting work.

- source_spec: `docs/implementation/spec-3-1-confident-answer-generation.md`
  summary: Neither `AskService` nor `GeminiProvider` bounds or cancels the embedding call or either of the up-to-two `generateStructuredOutput` calls server-side -- only `apps/web`'s proxy route enforces a client-side `AbortSignal.timeout` (30s), and that timeout path itself has no test exercising an actual hang (only a synchronously-rejecting `fetch`). If the proxy gives up, the abandoned request in `apps/api` keeps running with nothing to stop it.
  evidence: Same accepted-gap family as the cost-exposure entries above (Epic 4's job); the 30s client-side budget appeared to have real margin in live testing (each real Gemini call observed well under 1s), but that margin isn't verified against the worst case (1 embedding + 2 sequential generation calls) or enforced server-side. Revisit alongside Epic 4's rate limiting/timeout work.

- source_spec: `docs/implementation/spec-3-1-confident-answer-generation.md`
  summary: `AnswerSchema` (`libs/shared/src/lib/answer.ts`) validates shape only -- it has no refinement tying `confidence` to `insufficientEvidence` (e.g. `confidence: "high"` with `insufficientEvidence: true` is schema-valid but nonsensical), and `createAIProviderProvider()` is registered independently by `PapersModule` and `AskModule`, giving each module its own separately-memoized `AIProvider` instance rather than one true shared singleton (the "shared" in that file's doc comment describes the reused factory code, not a shared runtime instance).
  evidence: Neither is a live bug today -- `AskService` is the only code that ever constructs an `Answer`, and it always pairs `confidence`/`insufficientEvidence` correctly by construction; two independently-memoized `AIProvider` instances cost an extra (cheap) client construction, not incorrect behavior. Both are defensive-hardening/doc-precision items, not fixes for anything currently wrong. Revisit if a second `Answer`-constructing code path is ever added, or if `AIProvider` construction ever becomes expensive enough that sharing one instance actually matters.

- source_spec: `docs/implementation/spec-gh-24-ai-provider-langchain.md`
  summary: `AIProvider.generateStructuredOutput<T>` (the interface) places no constraint on `T`, but the LangChain-backed `GeminiProvider` now calls `ChatGoogleGenerativeAI.withStructuredOutput<RunOutput extends Record<string, any>>(...)`, which requires the resolved type to be an object/record -- narrower than what the interface signature promises.
  evidence: Surfaced by code review; not a live bug -- the only current caller (`ask.service.ts` with `LlmAnswerOutputSchema`) already passes an object-shaped Zod schema. The old `@google/genai`-based implementation had no such constraint (it round-tripped through `JSON.parse` + `schema.safeParse` for any schema shape). Revisit if a future caller ever needs a non-object top-level schema, or tighten `AIProvider`'s type signature to document the real constraint.
