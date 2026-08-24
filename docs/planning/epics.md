---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - docs/planning/specs/spec-federalist-research/SPEC.md
  - docs/planning/specs/spec-federalist-research/decisions.md
  - docs/planning/specs/spec-federalist-research/data-model.md
  - docs/planning/specs/spec-federalist-research/stack.md
  - docs/planning/specs/spec-federalist-research/architecture-diagrams.md
  - docs/planning/specs/spec-federalist-research/ui-design.md
  - docs/planning/specs/spec-federalist-research/testing-approach.md
  - docs/planning/architecture/architecture-federalist_papers_ai_research_assistant-2026-08-24/ARCHITECTURE-SPINE.md
---

# federalist_papers_ai_research_assistant - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Federalist Research, decomposing requirements from `SPEC.md` (bmad-spec, used in place of a traditional PRD), `ui-design.md` (lightweight UX contract — no formal bmad-ux run exists for this project), and the finalized architecture spine into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: Users can browse a complete list of all 85 Federalist Papers, each showing number, title, and author(s). (CAP-1)
FR2: Users can search papers by paper number, author, title, exact keyword, or semantic concept. (CAP-2)
FR3: Users can ask a natural-language question and receive an answer grounded only in retrieved Federalist Papers passages. (CAP-3)
FR4: The system responds via one of three code-decided tiers — confident answer, clarify-with-best-guess, or refuse-insufficient-evidence — based on retrieval similarity, never on LLM self-reported confidence. (CAP-4)
FR5: Every substantive answer includes citations verified server-side against the chunks actually retrieved for that request. (CAP-5)
FR6: Users can open a cited paper from its citation and see the cited passage in context. (CAP-6)
FR7: Users can follow a link from any paper to its authoritative original source (the Avalon Project) to independently verify the text. (CAP-7)

### NonFunctional Requirements

NFR1: No authentication or user accounts — the system must function entirely without user identity.
NFR2: The AI provider (embeddings + generation) must be swappable via configuration/environment variables, never via application code changes.
NFR3: Vector search runs in PostgreSQL+pgvector only — no separate vector database.
NFR4: The application must be runnable locally by one engineer via Docker Compose (database only) + npm scripts.
NFR5: The unauthenticated AI-backed endpoint must have bounded cost exposure — per-IP and global-daily rate limiting, both DB-backed (not in-memory, not Redis).
NFR6: Retrieval filters (`paperNumber`/`author`) must apply in the SQL `WHERE` clause before the top-K `LIMIT`, never post-hoc.
NFR7: Ingestion must be idempotent (safe to re-run without duplicating documents) and transactional per paper (all-or-nothing).
NFR8: A `chunkId` is valid only within its originating request/response cycle — never persisted, bookmarked, or shared as a stable identifier.
NFR9: Lightweight logging (query, retrieved paper numbers, similarity scores, model/provider used, latency, errors) is emitted for every retrieval/answer request, to make retrieval-quality debugging easy — not a full observability platform. (Added via party-mode review — present in `stack.md` but originally missed as a tracked NFR.)

### Additional Requirements

- **No starter template** — Architecture specifies a from-scratch Nx monorepo (`apps/web`, `apps/api`, `libs/ai|database|documents|retrieval|shared`), not a pre-built starter. Epic 1 Story 1 scaffolds this directly.
- **Deployment**: two separate Vercel projects (`web`, `api` — api via Vercel's native NestJS serverless support, CORS enabled for web's origin) + Neon (Postgres 18, pgvector 0.8.6, pooled connection string in production). (AD-1, AD-3)
- **Local dev infra**: Docker Compose running exactly one service, `pgvector/pgvector` pinned to Postgres 18. Never part of the production deploy artifact. (AD-4)
- **Lib dependency graph**: `database`/`ai`/`documents` are sibling leaf libs with zero cross-dependencies; `retrieval` depends on `database`+`ai` and returns chunks+scores only; answer-generation and ingestion orchestration both live in `apps/api`, not a shared lib. (AD-6, AD-7, AD-8, AD-11)
- **Shared schemas**: `Answer`/`Citation` (read path) and ingestion chunk DTOs (write path) both live in `libs/shared`, single source of truth in each direction. (AD-9)
- **Config**: all environment differences (DB target, AI provider key) expressed via environment variables only, never environment-conditional code. (AD-5)
- **Rate-limit storage**: per-IP and daily-cap counters are both Postgres rows, atomic upsert. (AD-2)

### UX Design Requirements

*(No formal bmad-ux design contract exists for this project — extracted from `ui-design.md`, a lighter-weight spec companion.)*

UX-DR1: Two-column desktop layout — left: search/questions + answer; right: sources/citations/document context. Responsive.
UX-DR2: Clean academic/research aesthetic; explicitly avoid a generic ChatGPT-clone look. Emphasize documents, citations, source transparency, readability.
UX-DR3: Main page header "Federalist Research," subtitle "Explore the Federalist Papers with source-grounded AI."
UX-DR4: "Ask the Archive" section — prominent question input with example prompts shown to the user.
UX-DR5: "Answer" section displays answer text, confidence indicator, citations, and source passages together.
UX-DR6: "Related Papers" section shows papers related to the current question.
UX-DR7: "Browse Papers" section lists all 85 papers (number, title, author(s)).
UX-DR8: "Paper Reader" shows paper number, title, author(s), complete text, and the cited passage in context when accessed from an answer.
UX-DR9: The verification (`sourceUrl`) link renders as a quiet tag near the paper title — not inline per-passage, not in a drawer.

### FR Coverage Map

FR1: Epic 1 - Browse all 85 papers with metadata
FR2: Epic 2 - Search by number/author/title/keyword/semantic concept
FR3: Epic 3 - Ask a natural-language question, get a grounded answer
FR4: Epic 3 - Tiered confidence response (answer/clarify/refuse)
FR5: Epic 3 - Server-verified citations
FR6: Epic 3 - Navigate from a citation to the passage in context
FR7: Epic 1 - Independent source verification link

NFR1 (no auth): respected throughout, not a build item
NFR2 (provider-agnostic AI abstraction): Epic 1 (embedding half), Epic 3 (generation half)
NFR3 (pgvector only): Epic 1
NFR4 (locally runnable): Epic 1
NFR5 (rate limiting): Epic 4
NFR6 (filter-before-limit): Epic 2
NFR7 (idempotent transactional ingestion): Epic 1
NFR8 (chunkId ephemerality): Epic 3 (server-side lifetime and frontend never re-fetches by it)
NFR9 (lightweight logging): Story 0.1 (established), Story 3.1 (extended to the real answer-generation path)

UX-DR1–UX-DR3, UX-DR7 (layout, aesthetic, header, Browse Papers): Epic 1
UX-DR4–UX-DR6 (Ask the Archive, Answer, Related Papers): Epic 3
UX-DR8 (Paper Reader passage-in-context): Epic 3
UX-DR9 (verification link placement): Epic 1

## Epic List

### Epic 1: Browse the Archive
Users can browse and read all 85 Federalist Papers with correct metadata and a link to verify each one against its authoritative source — the first real, demoable slice, even before any AI features exist.
**FRs covered:** FR1, FR7 · **NFRs covered:** NFR2 (partial — embedding half of the AI abstraction), NFR3, NFR4, NFR7, NFR8 (partial)

### Epic 2: Search the Archive
Users can search papers by number, author, title, keyword, or semantic concept, with correct results — builds on Epic 1's data, adds the retrieval layer.
**FRs covered:** FR2 · **NFRs covered:** NFR6

### Epic 3: Ask the Archive
Users can ask a natural-language question and receive a grounded, cited, confidence-tiered answer, and can click any citation to land on the correct paper with the passage shown in context — builds on Epic 2's retrieval, adds the AI answer-generation abstraction, orchestration, and citation navigation (merged in from a standalone "Navigate from Citations" epic via Abstraction Laddering — it didn't have a standalone value proposition distinct from Q&A itself).
**FRs covered:** FR3, FR4, FR5, FR6 · **NFRs covered:** NFR2 (completing the AI abstraction), NFR8 (completing chunk-lifetime handling)

### Epic 4: Public, Always-On Access
Anyone with the link — not just the developer running it locally — can actually use the deployed application, with cost exposure bounded so it can be left running.
**NFRs covered:** NFR1 (respected, not built), NFR5

**Sequencing note (added via party-mode review):** a throwaway de-risk spike (Story 0.1, below) runs before Epic 1 to prove the riskiest unknown — grounded retrieval + LLM answer generation + citation verification actually working on real data — early and cheaply. It does **not** reorder the epics: Epic 1→2→3→4 proceeds exactly as designed above once the spike is deleted. The spike answers "does the core mechanism work at all," not "build the flagship feature first."

## Story 0.1: De-Risk Spike — Prove the RAG Pipeline End-to-End

*Explicitly throwaway. Not part of the FR/NFR coverage map — this story validates a risk, it doesn't ship a capability. Deleted (not gradually polished) once it's done its job.*

As a developer,
I want to prove, with a small, unstyled, throwaway slice, that grounded retrieval + LLM answer generation + citation verification actually works on real Federalist Papers data,
So that the flagship feature's core technical risk is validated before investing in Epic 1–3's real ingestion pipeline, UI, or polish.

**Acceptance Criteria:**

**Precondition (do this first, not assumed to already exist):** the retrieval evaluation dataset (`testing-approach.md`'s question → expected-paper(s) format) is created, scoped to at least the handful of papers ingested for this spike — this is the yardstick the spike is proving against, not furniture already in the room.

**Given** a small handful of papers (not all 85) minimally ingested with chunks and embeddings
**When** a bare, unstyled textbox submits a question
**Then** a bare `retrieveRelevantChunks` call, a bare LLM call, and citation-ID verification produce a plain-text answer with at least one real, server-verified citation
**And** running the retrieval evaluation script against the just-created eval dataset shows the expected paper appearing in top-K for at least those sample questions
**And** basic logging (query, retrieved paper numbers, similarity scores, model/provider used, latency) is emitted for every request — the lightweight debugging signal `stack.md` calls for (NFR9), established here rather than bolted on later
**And** no confidence tiers, clarify/refuse logic, production UI, or styling are built here — this is deliberately the smallest possible proof, not a preview of the real feature
**And** the spike is timeboxed; if it cannot produce a trustworthy grounded answer within that window, that's flagged before any further epic work begins, not after
**And** once the spike has answered the question, its code is deleted or rebuilt from scratch against the architecture spine's real lib boundaries (AD-6–AD-9) — it is not gradually polished in place into Epic 1–3's real implementation

## Epic 1: Browse the Archive

Users can browse and read all 85 Federalist Papers with correct metadata and a link to verify each one against its authoritative source.

### Story 1.1: Nx Monorepo & Local Dev Environment Setup

As a developer,
I want the Nx monorepo scaffolded with a working local dev loop,
So that every subsequent story has a working foundation to build on instead of starting from nothing.

**Acceptance Criteria:**

**Given** an empty repository
**When** the scaffolding is complete
**Then** `apps/web` (Next.js), `apps/api` (NestJS), and empty `libs/ai`, `libs/database`, `libs/documents`, `libs/retrieval`, `libs/shared` exist per the architecture spine's Structural Seed
**And** `docker-compose up` starts a `pgvector/pgvector` container pinned to Postgres 18 (AD-4)
**And** `nest start` and `next dev` run against that local database via `DATABASE_URL` (AD-5) with no hardcoded connection values in code
**And** linting and a basic test runner are configured and pass on the empty scaffold

### Story 1.2: Federalist Papers Ingestion Pipeline

*Kept as one story, not split into a "pure parse/chunk" story and a "flaky embed/store" story as Winston raised — Story 0.1's spike already proves the embed/retrieve/LLM path works at small scale before this story runs it at full scale, which is what his concern was actually about. Splitting further here would be solving a risk the spike already retired.*

As a developer,
I want an idempotent ingestion pipeline that fetches, parses, chunks, embeds, and stores all 85 Federalist Papers,
So that real data exists in the database for every user-facing feature to build on.

**Acceptance Criteria:**

**Given** the Avalon Project as the ingestion source (`decisions.md`, "Source selection")
**When** `npm run ingest:federalist-papers` runs against an empty database
**Then** all 85 `FederalistPaper` rows are created with correct `paperNumber`, `title`, `author` (many-to-many, correctly representing joint/disputed authorship per Nos. 18–20 and 62–63), `sourceUrl`, and `fullText`
**And** each paper's text is chunked per the configured strategy (paragraph boundaries, ~500–1,000 tokens, configurable) and embedded via `libs/ai`, stored as `DocumentChunk` rows
**And** each paper's metadata-upsert + chunk-delete + chunk-insert runs as a single transaction (AD-10) — a simulated failure mid-paper leaves that paper's prior state unchanged, not partially updated
**When** the ingestion command is run a second time with no source changes
**Then** no duplicate `FederalistPaper` or `DocumentChunk` rows are created (NFR7)

### Story 1.3: Browse All Papers

As a researcher,
I want to see a list of all 85 Federalist Papers with their number, title, and author(s),
So that I can find a paper I already know I'm looking for.

**Acceptance Criteria:**

**Given** all 85 papers have been ingested
**When** I open the Browse Papers view
**Then** exactly 85 entries are listed, each showing paper number, title, and author(s) (UX-DR7)
**And** the page matches the two-column, academic-not-ChatGPT aesthetic (UX-DR1, UX-DR2) and the "Federalist Research" header/subtitle (UX-DR3)
**And** each entry links to that paper's full reader view

### Story 1.4: Read a Paper with Source Verification

As a researcher,
I want to open a paper and read its complete text, with a link to its authoritative original source,
So that I can read the primary source and independently confirm it's not fabricated.

**Acceptance Criteria:**

**Given** a paper has been ingested
**When** I open its reader view
**Then** I see the paper number, title, author(s), and complete text (UX-DR8, partial — passage-in-context comes in Epic 3)
**And** a quiet "Source: Avalon Project ↗" tag appears near the paper title, linking to that paper's exact `sourceUrl` (UX-DR9, `decisions.md` "Verification link placement")
**And** the link opens the real Avalon Project page for that paper number, not a generic homepage

## Epic 2: Search the Archive

Users can search papers by number, author, title, keyword, or semantic concept, with correct results.

### Story 2.1: Search by Number, Author, Title, or Keyword

As a researcher,
I want to search papers by their number, author, title, or an exact keyword in the text,
So that I can quickly find a specific paper or passage when I already have some idea what I'm looking for.

**Acceptance Criteria:**

**Given** all 85 papers have been ingested
**When** I search by paper number
**Then** I get the exact matching paper
**When** I search by author name
**Then** I get all papers by that author, correctly including jointly-authored papers (e.g. searching "Madison" returns Nos. 18–20 and the disputed 62–63, not just his solely-authored papers)
**When** I search by title text or an exact keyword found in a paper's body
**Then** matching papers are returned via a direct query against `libs/database` — no embeddings, no `libs/retrieval` involvement, no separate search database introduced (SPEC.md Non-goals)

### Story 2.2: Search by Semantic Concept

As a researcher,
I want to search using a concept or idea rather than exact wording,
So that I can find relevant papers even when I don't know the specific 18th-century terminology used.

**Acceptance Criteria:**

**Given** all 85 papers have been ingested with embeddings (Epic 1, Story 1.2)
**When** I search using a semantic query
**Then** `libs/retrieval` embeds the query and returns the top-K most similar chunks via pgvector similarity search, each with its similarity score
**And** retrieval applies no confidence-threshold logic of its own — it returns scores, nothing more (AD-7; threshold interpretation is Epic 3's job)
**When** a semantic search is combined with a `paperNumber` or `author` filter
**Then** that filter applies in the SQL `WHERE` clause before the top-K `LIMIT`, never post-hoc (NFR6, AD-7)
**And** running the retrieval evaluation script (`testing-approach.md`) against the sample eval dataset shows each question's expected paper appearing in its top-K results
**And** hybrid (keyword + semantic combined) search is implemented only if it's straightforward on top of this — not a hard requirement for this story

## Epic 3: Ask the Archive

Users can ask a natural-language question and receive a grounded, cited, confidence-tiered answer, and can click any citation to land on the correct paper with the passage shown in context.

### Story 3.1: Confident Answer Generation

As a researcher,
I want to ask a question and receive a grounded answer with citations when retrieval is confident,
So that I get a trustworthy, sourced answer instead of a guess.

**Acceptance Criteria:**

**Given** a question whose top retrieved chunk scores at or above `confidentThreshold`
**When** I submit the question
**Then** the `apps/api` orchestrator calls the LLM with the retrieved passages, source metadata, and an explicit "answer only from this evidence" instruction (`architecture-diagrams.md`, "Prompt construction")
**And** the returned `Answer` (per the `libs/shared` Zod schema, AD-9) has `confidence` derived from the similarity score — never the LLM's self-report
**And** every citation's `chunkId` is verified against the actually-retrieved context before the response reaches the frontend; on a mismatch, one retry happens, then fail-safe to the insufficient-evidence response — the bad citation is never silently stripped (`decisions.md`, "Citation verification")
**And** the answer, confidence indicator, citations, and source passages render together in the Answer section (UX-DR5)
**And** basic logging (query, retrieved paper numbers, similarity scores, model/provider used, latency, errors) is emitted for every request (NFR9), extending the pattern established in Story 0.1

### Story 3.2: Clarify and Refuse Tiers

As a researcher,
I want the system to tell me when it's unsure or found nothing, rather than guessing,
So that I can trust every answer I actually receive.

**Acceptance Criteria:**

**Given** a question whose top score falls between `clarifyThreshold` and `confidentThreshold`
**When** I submit the question
**Then** no LLM call for generation happens — a code-generated response names the best-guess paper and asks for more detail, with `confidence: "low"` and `insufficientEvidence: true`
**Given** a question whose top score falls below `clarifyThreshold`
**When** I submit the question
**Then** the blanket "I couldn't find sufficient evidence in the Federalist Papers to answer that confidently" response is returned, with empty citations
**And** in both tiers, the decision is made entirely by the score check in the `apps/api` orchestrator — no LLM call occurs in either tier (AD-8, `decisions.md` "Confidence tiering")

### Story 3.3: Navigate from a Citation to Its Passage

As a researcher,
I want to click a citation and land on the right paper with the passage shown in context,
So that I can verify the answer against the primary source directly.

**Acceptance Criteria:**

**Given** an answer containing citations, displayed in the two-column layout's left side (question + answer) per UX-DR1
**When** I click one
**Then** the Paper Reader (Epic 1, Story 1.4) opens **in the right-hand column**, replacing the sources/citations view already living there per UX-DR1 — not an overlay, not a full-page navigation — for that citation's `paperNumber`, using the `paperNumber` and `quotedPassage` already held from the answer response, no re-fetch by `chunkId` (NFR8, `architecture-diagrams.md` "Navigating from a citation to its passage")
**And** the quoted passage is displayed above/beside the full text (or highlighted if practical) within that same right column
**And** the left column (my original question and answer) is never disturbed — resolving the earlier open question of *how* it's preserved: it's simply never replaced, because only the right column's content changes

### Story 3.4: Related Papers

As a researcher,
I want to see other papers related to my question even if they weren't directly cited,
So that I can explore the broader context around my question.

**Acceptance Criteria:**

**Given** a question has been answered
**When** I view the results
**Then** the Related Papers section (UX-DR6) shows papers from the same retrieval call that weren't necessarily cited in the answer itself
**And** no separate retrieval call is made to populate this section — it reuses the retrieval already performed for Story 3.1/3.2

## Epic 4: Public, Always-On Access

Anyone with the link — not just the developer running it locally — can actually use the deployed application, with cost exposure bounded so it can be left running.

### Story 4.1: Deploy to Vercel + Neon

As a visitor,
I want to access the application via a public URL without the developer running it locally,
So that I can actually try it myself.

**Acceptance Criteria:**

**Given** the application works end-to-end locally (Epics 1–3)
**When** it's deployed
**Then** `apps/web` and `apps/api` are two separate Vercel projects, `apps/api` via Vercel's native NestJS serverless support, with CORS enabled on `apps/api` for `apps/web`'s origin (AD-1)
**And** production `DATABASE_URL` points at Neon's pooled connection string on a Postgres 18 project — never the direct connection string (AD-1, AD-3)
**And** no application code differs between local and production — only environment variable values differ (AD-5)
**And** the ingestion script has been run once against Neon so real data exists before anyone visits the live URL
**And** the repository's README explains what the project does and why RAG is the right approach to it — this is the moment a stranger with zero context lands on the project, whether via the live URL or the repo itself, so the pitch and the deploy ship together

### Story 4.2: Rate Limiting to Bound Cost Exposure

As the developer,
I want the unauthenticated AI-backed endpoint to have bounded cost exposure,
So that the app can be left running indefinitely without risking an unexpected bill or silently exhausting a free-tier quota.

**Acceptance Criteria:**

**Given** no authentication exists anywhere in the application (NFR1)
**When** a client makes repeated requests to the ask endpoint
**Then** a per-IP throttle — a Postgres row keyed by `(ip, minute-bucket)`, atomically upserted — limits requests per minute
**When** total AI-backed requests across all callers reach the configured daily ceiling
**Then** a Postgres row keyed by `(global, date)` reflects the cap being hit, and the app returns a clear "daily limit reached, try again tomorrow" message instead of continuing to call the paid/metered provider (AD-2, `decisions.md` "Rate limiting")
**And** neither counter uses Redis or in-memory storage — both survive a serverless cold start correctly
