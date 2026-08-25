---
baseline_commit: 961e9d12690807790ac22c5d4da6ea114cc01d06
github_issue: https://github.com/scotthun/federalist_papers_ai_research_assistant/issues/1
branch: spike/story-0-1-rag-pipeline
---

# Story 0.1: De-Risk Spike — Prove the RAG Pipeline End-to-End

**Status:** review

**Explicitly throwaway.** Not part of the FR/NFR coverage map — validates a risk, doesn't ship a capability. Deleted (not gradually polished) once it's done its job. Never merged into `main`.

## Story

As a developer,
I want to prove, with a small, unstyled, throwaway slice, that grounded retrieval + LLM answer generation + citation verification actually works on real Federalist Papers data,
So that the flagship feature's core technical risk is validated before investing in Epic 1–3's real ingestion pipeline, UI, or polish.

## Acceptance Criteria

**Precondition:** the retrieval evaluation dataset (question → expected-paper(s)) is created, scoped to at least the handful of papers ingested for this spike.

1. Given a small handful of papers (not all 85) minimally ingested with chunks and embeddings, when a bare, unstyled textbox (or CLI) submits a question, then a bare `retrieveRelevantChunks` call, a bare LLM call, and citation-ID verification produce a plain-text answer with at least one real, server-verified citation.
2. Running the retrieval evaluation script against the just-created eval dataset shows the expected paper appearing in top-K for at least those sample questions.
3. Basic logging (query, retrieved paper numbers, similarity scores, model/provider used, latency) is emitted for every request (NFR9).
4. No confidence tiers, clarify/refuse logic, production UI, or styling are built here.
5. The spike is timeboxed; if it can't produce a trustworthy grounded answer within that window, that's flagged before further epic work begins.
6. Citation verification is proven to actually catch a bad citation, not just pass on good ones (a deliberately broken citation must be rejected).

## Dev Notes

- **Source of truth:** `docs/planning/epics.md` (Story 0.1) and `spike/spike.md`. This file is the authoritative task tracker going forward — `spike/spike.md`'s checklist is superseded by the Tasks/Subtasks below to avoid two trackers drifting.
- **Provider:** Gemini free tier (`GEMINI_API_KEY` in `spike/.env`, gitignored, already validated live against `v1beta/models`). Generation model: `gemini-3.6-flash` (verified live 2026-08-24 — `gemini-2.5-flash` 404s for new API keys; the API's own error pointed at this replacement). Embedding model: `gemini-embedding-001`, verified live at 3072 dimensions (not the 768 historically associated with older embedding models).
- **Ingestion source:** Avalon Project, `avalon.law.yale.edu/18th_century/fed{NN}.asp` (per `decisions.md` "Source selection"). Sample papers: No. 1, No. 10, No. 51 — chosen because their content was already spot-checked earlier in this project's research phase (factions, checks and balances, executive power) and are well-known enough to sanity-check answers against.
- **Database:** a throwaway `pgvector/pgvector` Postgres 18 container, separate compose file from the real Epic 1 setup (this code gets deleted).
- **Cut corners intentionally allowed here** (per Story 0.1's own scope): no NestJS, no Nx libs, no confidence tiers, no production schema — plain TypeScript scripts against `pg` directly.
- **Do not cut corners on:** citation verification must be a real check against retrieved chunk IDs, not a stub: this is the one thing the spike exists to prove.
- Per project persistent facts: no epic/story references in code comments; comments explain why, not what.

## Tasks / Subtasks

- [x] **Task 1: Spike scaffolding** (AC: enables 1–6)
  - [x] Initialize a minimal TypeScript project in `spike/` (package.json, tsconfig, vitest)
  - [x] Install deps: `pg` 8.23, `@google/genai` 2.18 (current unified Gemini SDK, not the legacy `@google/generative-ai`), `dotenv`, `tsx`, `vitest`
  - [x] `spike/docker-compose.yml` — `pgvector/pgvector:pg18` on port 55432 (distinct from any future real setup). Hit and fixed a real PG18 Docker image change: 18+ images require the volume mounted at `/var/lib/postgresql`, not `/var/lib/postgresql/data` (pg_ctlcluster-style layout) — container crash-looped until fixed. pgvector 0.8.6 confirmed enabled, matching the earlier architecture research.
  - [x] Verified Node → Postgres connectivity via `pg` + `dotenv`
- [x] **Task 2: Fetch and store sample papers** (AC: 1)
  - [x] Fetch Federalist No. 1, No. 10, No. 51 from the Avalon Project (via curl subprocess — Node's native `fetch` fails TLS verification in this environment against a corporate root CA that curl trusts via the system keychain; not an Avalon-specific issue)
  - [x] Parse title/author/full text from each — real markup turned out inconsistent across papers (No. 1/10 use one `<h3>` combining title+author, No. 51 uses two separate `<h4>` blocks) and correctly identified No. 51 as disputed `['HAMILTON', 'MADISON']` by searching heading text for the known closed set of author names rather than positional parsing
  - [x] `papers` table: id, paper_number, title, authors (text[]), source_url, full_text
  - [x] Unit tests for the Avalon HTML parser against the 3 real fixture pages (4 tests, all passing)
- [x] **Task 3: Chunk and embed** (AC: 1)
  - [x] Paragraph-based chunker (pure function), 6 unit tests including boundary cases (empty paragraphs, a single paragraph exceeding max size)
  - [x] Generated real embeddings via `gemini-embedding-001` (3072 dimensions, verified live — not the 768 historically associated with older embedding models) for each chunk; stored in `chunks` with a pgvector column, one transaction per paper (papers: 3/4/3 chunks respectively)
- [x] **Task 4: Retrieval evaluation dataset** (AC: Precondition, 2)
  - [x] `spike/eval-dataset.json` — 4 questions, expected papers scoped to Nos. 1, 10, 51
- [x] **Task 5: Bare retrieval** (AC: 1, 2)
  - [x] `retrieveRelevantChunks(embedding, topK)`: pgvector cosine similarity search (`<=>` operator) via `db.ts`, returns chunks + scores, no confidence-threshold logic (AD-7)
  - [x] Eval script (`npm run eval`) runs all 4 questions through real embedding + retrieval
  - [x] **All 4 passed against real data** — expected paper ranked #1 by score in every case, not just present somewhere in top-5
- [x] **Task 6: Bare answer generation + citation verification** (AC: 1, 6)
  - [x] Grounded prompt construction (question + retrieved passages + source metadata + "answer only from evidence", `ai.ts`)
  - [x] Gemini call (`gemini-3.6-flash`) producing a structured JSON answer + citations referencing chunk IDs
  - [x] Citation-ID verification (`verify-citations.ts`) — deterministic set-membership check, no model call
  - [x] Retry-then-fail-safe orchestration (`answer.ts`) per `decisions.md` "Citation verification": one corrected retry on a bad citation, then fall back to insufficient-evidence — never strips a bad citation and serves the rest
  - [x] Unit tests (7 total across `verify-citations.test.ts` + `answer.test.ts`): accepts a real chunkId, rejects a fabricated one, rejects a partially-fabricated set, treats zero citations as invalid, returns immediately on a good first attempt, retries once with an explicit correction naming the bad ID and the valid set, and **fails safe to insufficientEvidence if the retry also fabricates** (AC 6 proven deterministically, not left to hoping the live model misbehaves on cue)
- [x] **Task 7: Logging** (AC: 3)
  - [x] `ask.ts` and `ingest.ts` emit structured JSON logs: query, retrieved paper numbers, similarity scores, provider, latency, per request
- [x] **Task 8: End-to-end proof and verdict** (AC: 1, 5)
  - [x] Ran a real question end-to-end: "What arguments does Madison make about factions in Federalist No. 10?" — correct, well-structured answer, 5 citations, zero retries needed (valid on first attempt)
  - [x] Independently spot-checked 3 of the 5 quoted passages against the actual stored chunk content in Postgres (not just chunkId validity) — all 3 verbatim matches, not paraphrased or hallucinated
  - [x] **Verdict: WORKS.** See Completion Notes below.

## Dev Agent Record

### Implementation Plan

Plain TypeScript scripts against `pg` directly (no NestJS/Nx, per the story's own allowed corner-cutting): `avalon-parser.ts` (fetch/parse) → `chunker.ts` → `ai.ts` (Gemini embed/generate) → `db.ts` (storage + retrieval) → `verify-citations.ts` + `answer.ts` (the one thing not allowed to cut corners on) → `ingest.ts` / `eval.ts` / `ask.ts` as the three executable entry points. TDD red-green-refactor followed for every pure-logic module (parser, chunker, citation verification, answer orchestration); live API/DB calls proven via real runs rather than mocked, since the spike's entire purpose is proving the real integration works.

### Debug Log

- Postgres 18's Docker image changed its expected volume mount convention (`/var/lib/postgresql`, not `/var/lib/postgresql/data`) — container crash-looped until the compose file was corrected. Not an application bug.
- `gemini-2.5-flash` returned 404 ("no longer available to new users") on the live generation call; the API's own error named the replacement (`gemini-3.6-flash`), which was verified live and used instead.
- `gemini-embedding-001` defaults to 3072 dimensions (verified live), not the 768 sometimes associated with older embedding models — schema written to match the verified value, not assumed.
- Node's native `fetch` failed TLS verification against `avalon.law.yale.edu` in this environment (a corporate root CA trusted by curl/the system keychain but not Node's bundled CA store) — worked around by shelling out to `curl` for the one HTTP fetch this spike needs, rather than spending spike time debugging Node's trust store.
- Avalon's HTML markup is genuinely inconsistent across papers (No. 1/10 combine title+author in one `<h3>`; No. 51 splits them across two separate `<h4>` blocks). Solved by searching all heading text for the known closed set of author surnames rather than positional parsing — correctly identified No. 51 as disputed `['HAMILTON', 'MADISON']` as a natural consequence, not a special case.

### Completion Notes

**Verdict: the RAG pipeline works, well within the spike's timebox.** All 4 retrieval eval questions passed (expected paper ranked #1 by similarity score in every case, not merely present in top-K). One real end-to-end question produced a correct, well-grounded, five-citation answer with zero retries needed, and three of those five quoted passages were independently spot-checked against the actual stored chunk content — verbatim matches, not paraphrased or hallucinated. The one thing the spike was explicitly not allowed to cut corners on — citation verification actually catching a bad citation, not just passing on good ones — is proven by 4 deterministic unit tests covering accept/reject/partial-reject/empty cases plus the full retry-then-fail-safe orchestration (3 tests: succeeds first try, retries-then-succeeds, retries-then-fails-safe).

No confidence tiers, production UI, or Nx/NestJS structure were built, per scope. This code is throwaway: it stays on `spike/story-0-1-rag-pipeline`, is never merged into `main`, and Epic 1–3 rebuild the same concepts against the real `libs/` boundaries (AD-6–AD-9) rather than evolving this code in place.

**Recommendation:** proceed with Epic 1 as planned. No pivot needed.

## File List

- `spike/package.json`, `spike/tsconfig.json`, `spike/docker-compose.yml` — scaffolding
- `spike/src/avalon-parser.ts` — Avalon HTML → `{paperNumber, title, authors, fullText}`
- `spike/src/chunker.ts` — paragraph-based chunking with oversized-paragraph fallback
- `spike/src/ai.ts` — Gemini embedding + grounded-answer generation
- `spike/src/db.ts` — Postgres storage, transactional chunk replace, pgvector retrieval
- `spike/src/verify-citations.ts` — deterministic citation-ID verification
- `spike/src/answer.ts` — retry-then-fail-safe orchestration around verification
- `spike/src/schema.sql` — `papers` / `chunks` tables, pgvector(3072) column
- `spike/src/ingest.ts`, `spike/src/eval.ts`, `spike/src/ask.ts` — the three executable entry points
- `spike/eval-dataset.json` — 4 question → expected-paper(s) pairs
- `spike/test/avalon-parser.test.ts`, `spike/test/chunker.test.ts`, `spike/test/verify-citations.test.ts`, `spike/test/answer.test.ts` — 17 tests total, all passing
- `spike/test/fixtures/fed01.html`, `fed10.html`, `fed51.html` — real Avalon pages used as test fixtures
- `spike/.env` — `GEMINI_API_KEY`, `DATABASE_URL` (gitignored, not in this file list's diff)
- `spike/spike.md` — updated to point at this file as the tracker

## Change Log

- 2026-08-24: Story implemented end-to-end in a single session. All 8 tasks complete, all ACs satisfied, 17/17 tests passing, live end-to-end proof run and spot-checked against real stored data. Status: ready-for-dev → in-progress → review.
