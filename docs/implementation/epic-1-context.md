# Epic 1 Context: Browse the Archive

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Establish the project's foundation and first demoable slice: a working Nx monorepo with a local dev loop, a real ingestion pipeline that loads all 85 Federalist Papers (with correct metadata and authorship) into Postgres+pgvector, and a browsing/reading UI that lets a user see every paper and read its full text with a link to verify it against the authoritative source. This epic exists before any AI-answering features so there's a real, working slice of the product early, and so every later epic (search, Q&A, deployment) has real ingested data and a scaffolded codebase to build on.

## Stories

- Story 1.1: Nx Monorepo & Local Dev Environment Setup
- Story 1.2: Federalist Papers Ingestion Pipeline
- Story 1.3: Browse All Papers
- Story 1.4: Read a Paper with Source Verification

## Requirements & Constraints

- Users can browse a complete list of all 85 papers, each showing number, title, and author(s); the browse view must list exactly 85 entries, each linking to its full reader view.
- Users can follow a link from any paper to its authoritative original source to independently verify the text without relying on the app itself; every paper row must have a non-null, resolvable source URL.
- The application must be runnable locally by one engineer via Docker Compose (database only) plus npm scripts — no other local infra.
- Vector search runs in Postgres+pgvector only; no separate vector database is introduced.
- Ingestion must be idempotent (safe to re-run without duplicating data) and transactional per paper (all-or-nothing) — a failure mid-paper must leave that paper's prior state unchanged.
- The AI provider used for embeddings must be swappable via configuration/environment variables, never via application code changes (this epic covers only the embedding half; answer-generation is Epic 3).
- A `chunkId` produced during ingestion is only ever meaningful within a later request/response cycle — this epic just needs to create chunks correctly; enforcing ephemerality end-to-end is Epic 3's concern.

## Technical Decisions

- Scaffold a from-scratch Nx monorepo: `apps/web` (Next.js), `apps/api` (NestJS), and empty `libs/ai`, `libs/database`, `libs/documents`, `libs/retrieval`, `libs/shared`. No starter template. Leaf libs (`database`, `ai`, `documents`) never import from each other.
- Local dev: Docker Compose runs exactly one service, `pgvector/pgvector` pinned to Postgres 18 — local-dev-only, never part of the production deploy artifact. `apps/api`/`apps/web` run as normal local processes (`nest start`, `next dev`), never containerized.
- All environment differences (DB target, AI provider key) go through environment variables read at runtime (e.g. `DATABASE_URL`) — no hardcoded connection values, no `if isProd`-style branching.
- Data model: `FederalistPaper` (paperNumber, title, publicationDate, required `sourceUrl`, fullText) with many-to-many `Author` (plain TypeORM `@ManyToMany`, auto-managed join table — not a string/array column) to correctly represent disputed/joint authorship (Nos. 18–20, 62–63). `DocumentChunk` (paperId, chunkIndex, content, pgvector `embedding` column, optional section/heading/pageNumber/metadata) is 1-to-many from `FederalistPaper`.
- Ingestion source is locked to the Avalon Project: `avalon.law.yale.edu/18th_century/fed{NN}.asp`, zero-padded 01–85; this same URL is the `sourceUrl` shown to users. Ingestion is keyed by `paperNumber` for idempotency, and each paper's metadata-upsert + chunk-delete + chunk-insert runs as one DB transaction.
- Chunking: prefer paragraph/section boundaries, target ~500–1,000 tokens per chunk, modest configurable overlap, never split mid-paragraph if avoidable; chunk size is configurable, not hard-coded.
- Ingestion orchestration is a thin orchestrator in `apps/api` (e.g. a Nest standalone command) that fetches the source document itself, then composes `libs/documents` (parse/chunk, no I/O) + `libs/ai` (embed) + `libs/database` (store). Ingestion chunk DTOs (parsed-chunk shape and chunk-with-embedding shape) live in `libs/shared`, imported by all three libs to prevent write-path drift.
- Pinned versions: Next.js 16.3.2, NestJS 11.2.1, TypeORM 1.1.0, PostgreSQL 18.6, pgvector 0.8.6 (Neon serves 0.8.6 only on PG18 projects), Zod 4.4.3, Tailwind CSS + shadcn/ui on the frontend, LangChain.js for the AI provider abstraction.
- Conventions: entities PascalCase (`FederalistPaper`, `Author`, `DocumentChunk`); Nx libs kebab-case; NestJS files follow `*.module.ts`/`*.service.ts`/`*.controller.ts`; dates ISO 8601; API errors use NestJS's default `HttpException` shape (no custom error envelope); primary-key type (UUID vs. serial) is left to the migration author, not fixed by the architecture.
- Lightweight logging (query, retrieval count, paper numbers, similarity scores, model/provider, latency, errors) is an operational convention for the app generally — not required to be complete in this epic, but nothing here should conflict with it.

## UX & Interaction Patterns

- Two-column desktop layout (left: search/questions + answer; right: sources/citations/document context), responsive; Epic 1's browse/reader views should fit this shell even though the left column's AI features arrive in Epic 3.
- Clean academic/research aesthetic — explicitly not a generic ChatGPT-clone look; emphasize documents, citations, source transparency, readability.
- Main page header "Federalist Research", subtitle "Explore the Federalist Papers with source-grounded AI."
- Browse Papers section lists all 85 papers (number, title, author(s)); each row links to that paper's reader.
- Paper Reader shows paper number, title, author(s), and complete text (passage-in-context highlighting is added later, in Epic 3).
- The source-verification link renders as a quiet tag near the paper title (e.g. "Source: Avalon Project ↗") — not inline per-passage, not in a drawer — because Avalon's pages have no internal anchors, so the link can only ever land at the top of the paper.

## Cross-Story Dependencies

- Story 1.1 (scaffold) must complete before Story 1.2 (ingestion) can run against a real schema/codebase.
- Story 1.2 (ingestion) must complete — all 85 papers with authors, text, chunks, and embeddings stored — before Stories 1.3 (Browse) and 1.4 (Reader) have real data to display.
- This epic's ingested data (papers, authors, chunks, embeddings) is the foundation Epic 2 (search) and Epic 3 (ask) build their retrieval and Q&A features on; Epic 1's embedding-provider abstraction is half of the provider-agnostic AI requirement, completed by Epic 3's generation half.
- A throwaway de-risk spike (Story 0.1) precedes this epic to validate the retrieval/LLM/citation mechanism at small scale; Story 1.2 is the real, full-scale, idempotent/transactional ingestion pipeline, deliberately not split into separate parse/chunk vs. embed/store stories since the spike already retired that risk.
