---
title: 'Story 1.2: Federalist Papers Ingestion Pipeline'
type: 'feature'
created: '2026-08-24'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: '3fb7621204f8ac6970ffdd0044c749ca92997600'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.1 scaffolded empty `libs`/`apps` with no real data — every user-facing feature (browse, search, ask) needs actual Federalist Papers, chunks, and embeddings in Postgres to build on.

**Approach:** Build an idempotent, transactional ingestion pipeline — `libs/documents` (parse/chunk, no I/O), `libs/ai` (embedding-provider abstraction), `libs/database` (entities, migration, storage) — orchestrated by a thin `apps/api` Nx target that fetches, parses, chunks, embeds, and stores all 85 Federalist Papers from the Avalon Project.

## Boundaries & Constraints

**Always:**
- Avalon Project source, `avalon.law.yale.edu/18th_century/fed{NN}.asp` zero-padded 01–85; that URL is the paper's `sourceUrl`.
- `FederalistPaper` (unique `paperNumber`, `title`, `sourceUrl` required, `fullText`) many-to-many with `Author` via a plain TypeORM `@ManyToMany` (auto join table, never a string/array column) — correctly represents joint/disputed authorship (Nos. 18–20, 62–63).
- `DocumentChunk` (FK `paperId`, `chunkIndex`, `content`, pgvector `embedding` column, optional section/heading/pageNumber/metadata) 1-to-many from `FederalistPaper`.
- Chunking is paragraph-boundary based, target ~500–1,000 tokens (approximated via word count, per the proven spike algorithm), with a configurable overlap (the spike had none; add one) — never split mid-paragraph if avoidable.
- Each paper's metadata-upsert + chunk-delete + chunk-insert runs as **one** DB transaction (AD-10) — a failure mid-paper leaves that paper's prior state unchanged.
- Ingestion is idempotent, keyed by `paperNumber` (NFR7) — a second run with no source changes creates no duplicate rows.
- `libs/documents` performs parsing/chunking only, no I/O (AD-6/AD-11) — the `apps/api` orchestrator does the HTTP fetch.
- `libs/ai` owns the embedding-provider abstraction as an **Adapter**: a single `AIProvider` interface (`generateEmbedding()`, with room for `generateAnswer()`/`generateStructuredOutput()` to land in Epic 3 without a breaking rewrite) that every vendor SDK is adapted to; a small **Factory** reads an env var (`AI_PROVIDER`) and returns the matching concrete adapter. No call site ever imports a vendor SDK directly. Implement Google Gemini (`gemini-embedding-001`, 3072-dim) as the one initial adapter (proven in the Story 0.1 spike) — adding a second provider later means one new adapter class + one factory case, nothing else.
- Wire ingestion and migrations as real Nx project targets on `apps/api` (not bypassing raw scripts); mark the ingest target non-cacheable (side-effecting). Root `package.json`'s `ingest:federalist-papers` and `db:migrate` (per `stack.md`'s named commands) delegate to those targets.
- Fetch via Node's native `fetch` — never shell out to `curl` or another process.
- A modest delay between sequential page fetches (Avalon rate-limiting is untested and unguarded against in the spike).
- If one paper's ingestion fails, log it clearly and continue to the next paper rather than aborting the whole run.

**Ask First:** Any dependency, tool, or Nx workspace flag not already named in `stack.md` / the architecture spine / this spec.

**Never:**
- Implement search, browse UI, or Ask-the-Archive behavior (Epics 2–3) — this story is ingestion-only.
- Let `libs/documents` perform any I/O (HTTP fetch, DB, embedding calls).
- Hardcode a DB connection value or embedding-provider API key.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh ingestion | Empty DB, `npm run ingest:federalist-papers` | All 85 `FederalistPaper` rows created with correct `paperNumber`/`title`/author(s)/`sourceUrl`/`fullText`, each with chunks + embeddings stored | N/A |
| Joint/disputed authorship | Papers 18–20, 62–63 | `Author` many-to-many correctly includes every credited author, not an arbitrary single pick | N/A |
| Re-run, no source changes | Ingestion run a second time | No duplicate `FederalistPaper` or `DocumentChunk` rows (NFR7) | N/A |
| Simulated mid-paper failure | A failure injected during one paper's chunk-insert | That paper's prior metadata + chunks are unchanged, never partially updated (AD-10) | Transaction rolls back cleanly; the run continues to the next paper |
| One paper's fetch/parse fails | e.g. a transient network error on one page | That paper is skipped with a clearly logged error | Run continues; does not abort the remaining papers |

</frozen-after-approval>

## Code Map

- `docs/planning/specs/spec-federalist-research/data-model.md` -- entity shapes, authorship-modeling rationale.
- `docs/planning/specs/spec-federalist-research/decisions.md` -- Avalon source selection + re-ingestion pivot strategy, chunk-ID lifetime.
- `docs/planning/specs/spec-federalist-research/stack.md` -- chunking config, local dev commands (`db:migrate`, `ingest:federalist-papers`), AI provider abstraction shape.
- `docs/implementation/epic-1-context.md` -- Epic 1 context (still valid, no planning-doc changes since it was compiled).
- `docs/implementation/spec-1-1-nx-monorepo-setup.md` (status: done) -- prior story continuity: Structural Seed scaffolded, AD-6/7/9 boundaries already enforced in `eslint.config.mjs`, `DATABASE_URL` env-validation pattern in `apps/api/src/app/env.validation.ts` to extend rather than replace, `apps/api/src/app/app.module.ts`'s `TypeOrmModule.forRootAsync` currently has `entities: []` — this story populates it.
- Spike (branch `spike/story-0-1-rag-pipeline`, read via `git show spike/story-0-1-rag-pipeline:spike/src/<file>`) -- proven, read-only reference patterns: `avalon-parser.ts` (cheerio HTML parse, author-whitelist detection), `chunker.ts` (paragraph-packing algorithm + tests), `ai.ts` (Gemini embedding call shape), `db.ts` (upsert pattern). Known gaps to fix, not copy verbatim: two separate transactions (must become one per AD-10), no fetch rate-limiting, no chunk overlap, a `curl`-shell-out TLS workaround, and papers 18–20/62–63 never actually fetched or tested against the parser.
- `spike/.env` (gitignored, untracked, already present in the working tree) -- has a working `GEMINI_API_KEY` reusable for local dev/testing; copy its value into `apps/api/.env` (do not commit it, do not print it, do not copy `spike/.env` itself).

## Tasks & Acceptance

**Execution:**
- [x] `libs/database/src/lib/entities/{federalist-paper,author,document-chunk}.entity.ts` -- TypeORM entities matching `data-model.md` (many-to-many `Author`, pgvector `embedding` column) -- fulfills the schema requirement.
- [x] `libs/database` migration -- create tables + pgvector extension + `vector(3072)` column + index; wire into `apps/api`'s `TypeOrmModule` `entities` array -- makes the schema real (Story 1.1 left it empty).
- [x] `libs/documents/src/lib/avalon-parser.ts` -- parse Avalon HTML into paperNumber/title/author(s)/fullText, no I/O -- fulfills parsing; verify against live-fetched HTML for papers 18, 19, 20, 62, 63 specifically (never tested in the spike).
- [x] `libs/documents/src/lib/chunker.ts` -- paragraph-boundary chunker with configurable target/max size and overlap, no I/O -- fulfills chunking.
- [x] `libs/ai/src/lib/ai-provider.interface.ts` -- the `AIProvider` Adapter target interface (`generateEmbedding()` now; `generateAnswer()`/`generateStructuredOutput()` signatures reserved for Epic 3) -- gives every future provider a single contract to adapt to.
- [x] `libs/ai/src/lib/providers/gemini.provider.ts` -- concrete Adapter wrapping the Gemini SDK behind `AIProvider` -- fulfills the one-initial-provider requirement.
- [x] `libs/ai/src/lib/ai-provider.factory.ts` -- Factory selecting the concrete adapter from `AI_PROVIDER` (env var); everything outside `libs/ai` calls only the interface, never a vendor SDK -- makes swapping/adding providers a one-file change.
- [x] `apps/api` ingestion orchestrator (Nx target `ingest`, e.g. a Nest standalone command) -- fetches each Avalon page (native `fetch`, rate-limited delay, continues past a single paper's failure), composes `documents`+`ai`+`database`, one transaction per paper (AD-10) -- fulfills the end-to-end AC.
- [x] `package.json` -- add `db:migrate` and `ingest:federalist-papers` scripts delegating to the corresponding Nx targets.

**Acceptance Criteria:**
- Given the Avalon Project as source, when `npm run ingest:federalist-papers` runs against an empty database, then all 85 `FederalistPaper` rows are created with correct `paperNumber`, `title`, `author(s)`, `sourceUrl`, and `fullText`.
- Given ingestion runs, then each paper's text is chunked and embedded via `libs/ai`, stored as `DocumentChunk` rows.
- Given ingestion runs, then each paper's metadata-upsert + chunk-delete + chunk-insert is one transaction; a simulated failure mid-paper leaves that paper's prior state unchanged.
- Given the ingestion command is run a second time with no source changes, then no duplicate `FederalistPaper` or `DocumentChunk` rows are created.

## Spec Change Log

- 2026-08-24 -- `apps/api`'s `project.json` had `"tags": []` from Story 1.1 (it composed nothing yet). `@nx/enforce-module-boundaries` refuses to let an untagged project depend on *any* tagged library at all, so wiring the real ingestion orchestrator (which must import `libs/documents`+`libs/ai`+`libs/database`) required tagging it `scope:api` and adding one matching `depConstraints` entry in `eslint.config.mjs` (may depend on `scope:api`/`scope:database`/`scope:ai`/`scope:documents`/`scope:shared`). Required plumbing to let the orchestrator this story's tasks explicitly ask for actually compose the libs it needs; no change to any AD.
- 2026-08-24 -- TypeORM 1.1.0 (already pinned in Story 1.1) turns out to have first-class pgvector support (`type: 'vector'`/`'halfvec'` columns, auto to/from `number[]`, auto `CREATE EXTENSION IF NOT EXISTS vector` on connect) -- discovered by reading the installed driver source rather than assumed. Used directly (`@Column({ type: 'vector', length: 3072 })`) instead of a manual text-literal workaround.
- 2026-08-24 -- pgvector's HNSW/IVFFlat indexes cap indexed dimensions at 2000 for `vector` but 4000 for `halfvec`; Gemini's 3072-dim embedding exceeds the `vector` cap. The migration indexes a half-precision cast expression instead (`USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)`) -- pgvector's own documented pattern for this exact situation. Retrieval (Epic 2) must match this expression in its `ORDER BY` for the planner to use the index; noted inline in the migration.
- 2026-08-24 -- Node's native `fetch` fails TLS verification against `avalon.law.yale.edu` in this dev environment (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, reproduced directly) -- the same gap the Story 0.1 spike papered over by shelling out to `curl`. This story's constraint explicitly forbids that shell-out. Fixed at the Node level instead: the `ingest` Nx target's run command passes `--use-system-ca` (Node 24+), which makes Node trust the OS certificate store `curl` already trusts -- no shell-out, no vendored CA bundle.
- 2026-08-24 -- Live-verified the avalon-parser against papers 18, 19, 20, 62, 63 (per this story's task) plus a broader spot-check (1, 2, 5, 8, 10, 15, 30, 40, 50, 51, 55, 60, 70, 75, 78, 80, 84, 85) and found three real gaps the spike's algorithm (unchanged since it was only tried against 1/10/51) didn't hit: (1) the publication byline ("For the Independent Journal.", "From the New York Packet. <date>.", "From McLEAN'S Edition, New York.") was leaking into `title` on most papers, just not the couple the spike happened to test against -- fixed with a general byline/date-line filter, verified against the full sample. (2) Avalon's page for No. 70 republishes a second, textually different historical printing under a "Different Version of No. 70" heading further down the same page -- without truncating before it, No. 70's title and fullText both silently doubled up. (3) Footnote paragraphs carry a trailing "Return to the Text" back-link into the stored text -- stripped for fidelity. None of these change the Intent/AC; all are parser-correctness fixes now covered by `avalon-parser.spec.ts` fixtures fetched live from Avalon.
- 2026-08-24 -- Running the real `ingest` target against the live Gemini API surfaced a genuine free-tier rate limit (HTTP 429 `RESOURCE_EXHAUSTED`) when a paper's chunks were embedded concurrently (`Promise.all`) back-to-back across many papers. The per-paper failure handling this story requires caught and logged every occurrence correctly and the run always continued -- but to make a real full run actually complete rather than degrade into mostly-429s, chunk embedding within a paper was changed from concurrent to sequential, with a new configurable `INGEST_EMBED_DELAY_MS` (default 250ms) between calls. Also added `INGEST_FIRST_PAPER`/`INGEST_LAST_PAPER` env overrides (default 1/85) to make re-running a partial range (e.g. after a quota reset) possible without editing code. No change to the transaction/idempotency contract.
- 2026-08-24 -- Code review patch round (13 `patch`-classified findings, all fixed, no spec-intent change): (1) `ingest.ts`'s four operational env vars were computed as module-level consts at import time, before `loadLocalEnv()` (called inside `main()`) ever ran -- `.env` values were silently ignored, only real shell-exported vars worked; fixed by calling `loadLocalEnv()` at module top level and moving env-var reading into a function (`loadIngestConfig`) invoked from `main()`, and verified live by re-running `nx run api:ingest` with every relevant shell var unset, relying purely on `apps/api/.env`. (2) Added validation to `loadIngestConfig` (integer range checks, `first <= last`, non-negative delays) so a malformed value throws a clear error instead of silently becoming `NaN`; changed the exit-code rule to `succeeded === 0` (dropping `failed > 0`) so a zero-papers-processed run is never reported as success. (3) `ingestPaper` now throws if chunking produces zero chunks, rather than silently storing a paper with no content. (4) `avalon-parser.ts`'s `title` empty-string case now throws, mirroring the existing empty-`authors` check. (5) `ALTERNATE_VERSION_MARKER` truncation is now scoped to `paperNumber === 70` explicitly, not applied to every paper. (6) `KNOWN_AUTHORS`'s doc comment no longer cites papers 50/55 as verified -- only 18-20/62-63/70 were actually live-fetched and fixture-tested. (7) `chunkText` now throws if `overlapWords >= maxWords` (previously degenerated `splitOversizedParagraph`'s step size to 1, producing near-duplicate pieces). (8) `GeminiProvider.generateEmbedding` now validates the returned embedding is exactly 3072-dimensional, failing clearly instead of deferring to an opaque Postgres error later. (9) Per-paper error handling and the top-level `main().catch` now safely extract a message/stack from a non-`Error` rejection instead of logging `"undefined"`. (10) Added a 30s `AbortController` timeout to the per-paper `fetch` call so one hanging Avalon response can't stall the whole run. (11) Refactored the per-paper loop into an exported, injectable `runIngestion()` (plus `loadIngestConfig`/`shouldExitWithError`/`errorMessage`), closing the gap where the orchestrator's own continue-past-failure and exit-code behavior had no automated coverage; added `ingest.spec.ts` (14 cases) exercising it with fakes, guarded behind `if (require.main === module)` so importing the module for testing doesn't trigger a real run. (12) Added `npm run test:db-integration` (sets `DATABASE_URL` and runs `nx run database:test`) as the explicit, documented way to actually exercise the AD-10/NFR7 integration suite -- the plain `test` target correctly skips it by design when no DB is reachable, which the original Verification section's wording obscured; updated that section to name the new command. (13) Documented `findOrCreateAuthor`'s sequential-only invariant (safe today only because papers are never ingested in parallel). Also synced `INGEST_EMBED_DELAY_MS`/`INGEST_FIRST_PAPER`/`INGEST_LAST_PAPER` into the root `.env.example` (previously only in `apps/api/.env.example`) and added `INGEST_CHUNK_TARGET_WORDS`/`MAX_WORDS`/`OVERLAP_WORDS` env-var overrides for `DEFAULT_CHUNK_OPTIONS`, since `stack.md` requires chunk size to be genuinely runtime-configurable, not just a comment claiming so. Re-verified after all fixes: full `nx run-many -t lint,test` (workspace-wide) and `npm run test:db-integration` both pass. Also live-confirmed fix (1) specifically: `nx run api:ingest` with every relevant shell var unset (relying purely on `apps/api/.env`) picked up paper 1 correctly, proving `.env` values are no longer silently ignored -- a full 85-paper re-run against the already-fully-populated live DB was kicked off the same way as an idempotency/regression check; see this story's final verification notes for its outcome.

## Design Notes

"Tokens" in the chunk-size target are approximated via word count, matching the spike's proven chunker — `stack.md`'s own wording ("approximately 500–1,000 tokens") doesn't demand exactness, and adding a model-specific tokenizer dependency isn't justified here. The vector dimension (3072, Gemini's `gemini-embedding-001`) is pinned directly in the migration; changing the embedding model/dimension later is a deliberate, known-expensive migration (per `decisions.md`), not a design flaw. The ingest Nx target is marked non-cacheable — it's a side-effecting write against a live database, never a pure build step.

The AI provider abstraction is a deliberate Adapter + Factory pairing, not a speculative interface: `AIProvider` is the target interface every vendor is adapted to (Gemini today), and `ai-provider.factory.ts` is the single seam that reads `AI_PROVIDER` and constructs the right adapter. This keeps the door open for the user's stated goal — swapping the embedding provider later — without any call site outside `libs/ai` ever knowing which vendor is behind the interface.

## Verification

**Commands:**
- `nx run api:migrate` -- expected: schema created (tables, pgvector extension, vector column + index all exist).
- `npm run ingest:federalist-papers` against an empty DB -- expected: exits 0; 85 `FederalistPaper` rows, each with ≥1 `DocumentChunk` row carrying a non-null embedding.
- Re-run `npm run ingest:federalist-papers` -- expected: row counts unchanged (idempotent, NFR7).
- `nx run-many -t lint,test` -- expected: exit 0. Note: this does *not* exercise the AD-10/NFR7 integration test below -- `paper-ingestion.repository.integration.spec.ts` `describe.skip`s itself whenever `DATABASE_URL` is unset, specifically so the default `test` target never requires a live Postgres. That's deliberate, not a gap in this command alone.
- `npm run test:db-integration` (Postgres must be reachable, e.g. `docker-compose up -d` first) -- expected: exit 0; this is the actual coverage for AD-10 (mid-paper failure leaves prior state unchanged after rollback, verified against a real transaction) and NFR7 (idempotent re-run) -- run this explicitly, since the plain `test` target above skips it by design.

## Suggested Review Order

**AD-10 transaction (the core correctness requirement)**

- One transaction covers author find-or-create, paper metadata upsert, chunk delete, and chunk insert.
  [`paper-ingestion.repository.ts:49`](../../libs/database/src/lib/paper-ingestion.repository.ts#L49)

- Real-Postgres integration test proves the rollback -- and was verified to actually fail (not a false positive) when atomicity was temporarily removed during this story's own verification.
  [`paper-ingestion.repository.integration.spec.ts`](../../libs/database/src/lib/paper-ingestion.repository.integration.spec.ts)

**pgvector schema**

- `vector(3072)` column, native TypeORM 1.1.0 pgvector support.
  [`document-chunk.entity.ts:49`](../../libs/database/src/lib/entities/document-chunk.entity.ts#L49)

- Half-precision HNSW expression index -- works around pgvector's 2000-dim cap on `vector` indexes.
  [`1787627139314-InitSchema.ts:80`](../../libs/database/src/migrations/1787627139314-InitSchema.ts#L80)

**Parser correctness (papers 18-20/62-63/70, never tested in the spike)**

- Alternate-version truncation, footnote back-link stripping, byline/date-line title filtering.
  [`avalon-parser.ts:18`](../../libs/documents/src/lib/avalon-parser.ts#L18)

- Fixtures fetched live from Avalon for every disputed-authorship paper plus No. 70.
  [`avalon-parser.spec.ts`](../../libs/documents/src/lib/avalon-parser.spec.ts)

**Chunker overlap (new vs. the spike)**

- Overlap carries whole trailing paragraphs forward, never splitting one, and never lets carried-over overlap push a chunk past `maxWords`.
  [`chunker.ts:45`](../../libs/documents/src/lib/chunker.ts#L45)

**AI provider Adapter + Factory**

- Single seam reading `AI_PROVIDER`; every call site outside `libs/ai` depends only on this, never a vendor SDK.
  [`ai-provider.factory.ts:13`](../../libs/ai/src/lib/ai-provider.factory.ts#L13)

**Orchestrator wiring**

- `apps/api` tagged `scope:api` with a matching `depConstraints` entry -- required for the orchestrator to import `documents`+`ai`+`database` at all under `@nx/enforce-module-boundaries`.
  [`eslint.config.mjs:51`](../../eslint.config.mjs#L51)

- `--use-system-ca` on the `ingest` target's run command -- the real fix for a native-`fetch` TLS gap against avalon.law.yale.edu, without the spike's `curl` shell-out.
  [`project.json:97`](../../apps/api/project.json#L97)

- Sequential, delayed chunk embedding -- added after a live run hit Gemini's free-tier rate limit; per-paper failure handling already caught it, this just makes hitting it less likely.
  [`ingest.ts:99`](../../apps/api/src/ingest.ts#L99)

**Code-review patch round (orchestration testability + fail-fast validation)**

- `runIngestion()` factored out as an injectable, exported function -- the continue-past-failure loop and exit-code contract are now covered by `ingest.spec.ts` with fakes, not just a real end-to-end run.
  [`ingest.ts:228`](../../apps/api/src/ingest.ts#L228)

- `shouldExitWithError` -- a run that succeeds on zero papers is never reported as success, closing the case where a misconfigured/empty range silently exited 0.
  [`ingest.ts:270`](../../apps/api/src/ingest.ts#L270)

- `loadIngestConfig` -- validates every operational env var (integer range, non-negative delays, `first <= last`), throwing instead of silently producing `NaN`; also the fix for `.env` values being ignored (moved `loadLocalEnv()` to module top level).
  [`ingest.ts:99`](../../apps/api/src/ingest.ts#L99)

- `GeminiProvider` now validates the returned embedding is exactly 3072-dimensional before it ever reaches Postgres.
  [`gemini.provider.ts:39`](../../libs/ai/src/lib/providers/gemini.provider.ts#L39)

- `chunkText` rejects `overlapWords >= maxWords` up front instead of letting the oversized-paragraph fallback silently degenerate.
  [`chunker.ts:74`](../../libs/documents/src/lib/chunker.ts#L74)

- Empty-`title` guard mirrors the existing empty-`authors` guard.
  [`avalon-parser.ts:95`](../../libs/documents/src/lib/avalon-parser.ts#L95)

- `npm run test:db-integration` -- the actual, documented way to exercise the AD-10/NFR7 integration suite; the plain `test` target skips it by design.
  [`package.json:12`](../../package.json#L12)
