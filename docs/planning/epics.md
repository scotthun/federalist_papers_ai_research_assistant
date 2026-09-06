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
  - docs/planning/ux-designs/ux-federalist_papers_ai_research_assistant-2026-08-29/DESIGN.md
  - docs/planning/ux-designs/ux-federalist_papers_ai_research_assistant-2026-08-29/EXPERIENCE.md
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
FR8: Users can ask multiple independent questions in a row via a global quill chat widget, with visible history preserved across page navigation within the same browser tab, optionally scoped to the paper currently being read. (CAP-8, added 2026-09-02 for the quill chat widget)
FR9: A confident-tier answer's prose streams to the client token-by-token; citations attach only after the full response completes and passes existing server-side citation verification. (CAP-9, added 2026-09-02 for the quill chat widget)

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
NFR10: Chat conversation state is client-side only (`sessionStorage`), never persisted server-side or in the database; each chat message is a fully independent, stateless request to the ask endpoint — no server-side conversational memory. (Added 2026-09-02 for the quill chat widget, consistent with NFR1: no auth/user accounts.)

### Additional Requirements

- **No starter template** — Architecture specifies a from-scratch Nx monorepo (`apps/web`, `apps/api`, `libs/ai|database|documents|retrieval|shared`), not a pre-built starter. Epic 1 Story 1 scaffolds this directly.
- **Deployment**: two separate Vercel projects (`web`, `api` — api via Vercel's native NestJS serverless support, CORS enabled for web's origin) + Neon (Postgres 18, pgvector 0.8.6, pooled connection string in production). (AD-1, AD-3)
- **Local dev infra**: Docker Compose running exactly one service, `pgvector/pgvector` pinned to Postgres 18. Never part of the production deploy artifact. (AD-4)
- **Lib dependency graph**: `database`/`ai`/`documents` are sibling leaf libs with zero cross-dependencies; `retrieval` depends on `database`+`ai` and returns chunks+scores only; answer-generation and ingestion orchestration both live in `apps/api`, not a shared lib. (AD-6, AD-7, AD-8, AD-11)
- **Shared schemas**: `Answer`/`Citation` (read path) and ingestion chunk DTOs (write path) both live in `libs/shared`, single source of truth in each direction. (AD-9)
- **Config**: all environment differences (DB target, AI provider key) expressed via environment variables only, never environment-conditional code. (AD-5)
- **Rate-limit storage**: per-IP and daily-cap counters are both Postgres rows, atomic upsert. (AD-2)

### UX Design Requirements

*(Originally extracted from `ui-design.md`, a lighter-weight spec companion — no formal bmad-ux design contract existed for this project until the quill chat widget run below.)*

UX-DR1: Two-column desktop layout — left: search/questions + answer; right: sources/citations/document context. Responsive. **Superseded 2026-09-02** — this was the inline "Ask the Archive" box's layout; see UX-DR11 (`EXPERIENCE.md` §Foundation, §"Supersedes ui-design.md").
UX-DR2: Clean academic/research aesthetic; explicitly avoid a generic ChatGPT-clone look. Emphasize documents, citations, source transparency, readability. (Realized concretely by the "Parchment & Manuscript" direction — see UX-DR17.)
UX-DR3: Main page header "Federalist Research," subtitle "Explore the Federalist Papers with source-grounded AI."
UX-DR4: "Ask the Archive" section — prominent question input with example prompts shown to the user. **Superseded 2026-09-02** — the inline box is removed; the global quill launcher is now the sole entry point (see UX-DR10, `EXPERIENCE.md` §"Supersedes ui-design.md").
UX-DR5: "Answer" section displays answer text, confidence indicator, citations, and source passages together. **Superseded 2026-09-02** — this content now renders inside the quill chat panel, not a main-page section (see UX-DR11, UX-DR14).
UX-DR6: "Related Papers" section shows papers related to the current question. **Resolved 2026-09-02** — folds into the chat panel rather than a separate page section: a related-papers list renders below the answer bubble once streaming completes, styled like citation links; clicking an entry navigates to that Paper Reader and collapses the panel (same mechanics as UX-DR15's citation click, minus the passage highlight). See UX-DR20.
UX-DR7: "Browse Papers" section lists all 85 papers (number, title, author(s)). Unchanged.
UX-DR8: "Paper Reader" shows paper number, title, author(s), complete text, and the cited passage in context when accessed from an answer. Unchanged; see UX-DR15 for the quill's citation-click behavior specifically.
UX-DR9: The verification (`sourceUrl`) link renders as a quiet tag near the paper title — not inline per-passage, not in a drawer. Unchanged.

**Quill chat widget (`DESIGN.md` + `EXPERIENCE.md`, finalized 2026-09-02):**

UX-DR10: A global, session-persistent quill launcher (56px circle, bottom-right, every page) replaces the inline "Ask the Archive" box as the sole entry point to asking a question. (`EXPERIENCE.md` §Foundation, §IA)
UX-DR11: Launcher opens a chat panel — 340px popup docked bottom-right on desktop (`≥ md`), full-screen takeover on mobile (`< md`); the underlying page is unaffected in the desktop case. (`EXPERIENCE.md` §Foundation, §Responsive & Platform)
UX-DR12: Chat history persists across page navigation within a browser tab (`sessionStorage`, no server persistence — see NFR10) and is not cleared by opening/closing the panel. (`EXPERIENCE.md` §Foundation, §Component Patterns)
UX-DR13: Opening the panel from a Paper Reader page shows a removable "📄 {Paper Title}" context chip that scopes the next question to that paper; removing it reverts to whole-archive scope for the rest of that conversation. (`EXPERIENCE.md` §Component Patterns, §State Patterns)
UX-DR14: Confident-tier answers stream token-by-token with a trailing cursor and a quiet "streaming…" caption; clarify/refuse tiers render instantly with no streaming cursor (no LLM call). (`EXPERIENCE.md` §State Patterns)
UX-DR15: Clicking a citation in the chat panel navigates the page to the Paper Reader for that citation (passing the already-held `paperNumber` + quoted passage, no `chunkId` re-fetch per NFR8), scrolls to/highlights the passage, and collapses the panel back to the launcher icon without clearing history. (`EXPERIENCE.md` §Component Patterns, §Interaction Primitives)
UX-DR16: First-time visitors get a one-time discoverability nudge — the launcher pulses once and a tooltip auto-opens ("Ask me about the Federalist Papers →"), then permanently settles to icon-only for that session; returning visitors get no repeat nudge. (`EXPERIENCE.md` §State Patterns)
UX-DR17: "Parchment & Manuscript" visual direction — aged-parchment/ink palette (no blue/green/"tech" colors), single serif family (Georgia/Times/serif) throughout, oxblood-red reserved exclusively for interactive elements, muted gold signals "the Archive is present" (never used for buttons/links), dog-eared asymmetric corner radius unique to the chat panel. (`DESIGN.md` §Colors, §Typography, §Shapes)
UX-DR18: WCAG 2.2 AA across the reading surface and quill panel (verify `ink-muted`/oxblood-on-parchment contrast specifically); launcher/panel fully keyboard-operable; streaming answer bubble uses `aria-live="polite"`; citations are real links/buttons with accessible names including the paper number; tap targets ≥ 44px. (`EXPERIENCE.md` §Accessibility Floor)
UX-DR19: Desktop-popup vs. mobile-full-screen breakpoint reuses `apps/web`'s existing responsive breakpoint token — not a new value. [ASSUMPTION carried from `EXPERIENCE.md`: confirm the exact px value against the codebase before building.] (`EXPERIENCE.md` §Responsive & Platform)
UX-DR20: A related-papers list renders below the answer bubble once streaming completes, styled like citation links; clicking an entry navigates to that paper's Reader and collapses the panel, same mechanics as a citation click (UX-DR15) minus the passage highlight. Resolves UX-DR6. (`EXPERIENCE.md` §Component Patterns, §State Patterns)

### FR Coverage Map

FR1: Epic 1 - Browse all 85 papers with metadata
FR2: Epic 2 - Search by number/author/title/keyword/semantic concept
FR3: Epic 3 - Ask a natural-language question, get a grounded answer
FR4: Epic 3 - Tiered confidence response (answer/clarify/refuse)
FR5: Epic 3 - Server-verified citations
FR6: Epic 3 - Navigate from a citation to the passage in context
FR7: Epic 1 - Independent source verification link
FR8: Epic 5 - Persistent multi-question chat session (quill widget)
FR9: Epic 5 - Streaming answer delivery

NFR1 (no auth): respected throughout, not a build item
NFR2 (provider-agnostic AI abstraction): Epic 1 (embedding half), Epic 3 (generation half)
NFR3 (pgvector only): Epic 1
NFR4 (locally runnable): Epic 1
NFR5 (rate limiting): Epic 4
NFR6 (filter-before-limit): Epic 2
NFR7 (idempotent transactional ingestion): Epic 1
NFR8 (chunkId ephemerality): Epic 3 (server-side lifetime and frontend never re-fetches by it)
NFR9 (lightweight logging): Story 0.1 (established), Story 3.1 (extended to the real answer-generation path)
NFR10 (chat is stateless/client-side-only): Epic 5

UX-DR1 (two-column layout): superseded, see UX-DR11 — Epic 5
UX-DR2, UX-DR3 (aesthetic, header): Epic 1 (header/subtitle); realized in full by Epic 5's visual direction (UX-DR17)
UX-DR4–UX-DR6 (Ask the Archive, Answer, Related Papers): all three superseded/resolved by Epic 5 (UX-DR10, UX-DR11, UX-DR14 for UX-DR4/5; UX-DR20 for UX-DR6)
UX-DR7 (Browse Papers): Epic 1
UX-DR8 (Paper Reader passage-in-context): Epic 3; quill-specific citation-click behavior is UX-DR15 — Epic 5
UX-DR9 (verification link placement): Epic 1
UX-DR10–UX-DR20 (quill chat widget: launcher, panel, persistence, context chip, streaming, citation navigation, discoverability, visual direction, accessibility, responsive behavior, related papers): Epic 5

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

### Epic 5: Ask the Archive via the Quill
Users can ask questions through a persistent, floating chat widget available on every page — with streaming answers, citations that navigate to the exact passage, related-paper suggestions, and a removable page-aware context chip when reading a specific paper — replacing the old inline "Ask the Archive" page section entirely. Builds on Epic 3's ask-orchestration/confidence-tiering/citation-verification backend and Epic 1's Paper Reader (reused, not rebuilt), but delivers the full ask → stream → cite → navigate → related loop standalone.
**FRs covered:** FR8, FR9 · **UX-DRs covered:** UX-DR10–UX-DR20 (added 2026-09-02, from the finalized `bmad-ux` quill chat widget run) · **NFRs covered:** NFR10

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

**Note 2026-09-02:** Implemented as a same-page grid swap inside `AskQuestion` (private `selectedCitation`/`paperState` state, no route change) — by design at the time, per this story's own Boundaries. Epic 5 retires the inline two-column `AskQuestion` layout entirely; Story 5.1 extracts the reusable pieces (`PaperReader`, `/api/papers/[paperNumber]`) into the quill panel and replaces this story's private state machine with the quill's own citation-click handling. The AC below is preserved for history, not the shipped end-state once Epic 5 lands.

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

**Superseded 2026-09-02 by Story 5.3** — same mechanism (reuse the retrieval already performed for Story 3.1/3.2, no separate call), but the presentation moves from a main-page "Related Papers" section to the quill chat panel, since the inline two-column layout this story's AC was written against no longer exists (see Epic 5). Not built under this story; see Story 5.3.

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

## Epic 5: Ask the Archive via the Quill

Users can ask questions through a persistent, floating chat widget available on every page — with streaming answers, citations that navigate to the exact passage, related-paper suggestions, and a removable page-aware context chip when reading a specific paper — replacing the old inline "Ask the Archive" page section entirely.

### Story 5.1: Quill Widget — Launcher, Panel & Streaming Ask

As a user researching the Federalist Papers,
I want to open a floating quill chat widget from anywhere in the app and ask a question that streams back an answer with clickable citations,
So that I can get grounded answers without leaving whatever page I'm on.

**Implementation note:** retires the inline two-column `AskQuestion` layout (Story 3.1–3.3's home). `AskQuestion` and its private `selectedCitation`/`paperState` state machine are deleted as part of this story, not left running alongside the quill — the panel is the only ask surface once this story ships. Reuse `PaperReader` and the `/api/papers/[paperNumber]` route as-is. The send control disables while a response is streaming, preventing duplicate in-flight requests from a double-click/tap (party-mode review, 2026-09-02).

**Acceptance Criteria:**

**Given** any page in the app
**When** it loads
**Then** a 56px quill launcher icon renders bottom-right, collapsed by default (UX-DR10)
**And** the launcher, panel, and all chat components (bubbles, input, citation links) are styled per `DESIGN.md`'s finalized "Parchment & Manuscript" tokens (colors, typography, dog-eared panel shape) — not placeholder/default styling (UX-DR17)

**Given** a first-time visit in this browser session
**When** the page loads
**Then** the launcher pulses once and an auto-opening tooltip reads "Ask me about the Federalist Papers →", then settles to icon-only for the remainder of the session (UX-DR16)
**And** a returning visit within the same session shows no pulse or tooltip

**Given** the launcher is collapsed
**When** the user clicks/taps it, or Tabs to it and presses Enter/Space
**Then** the panel opens — a 340px popup docked bottom-right on desktop (`≥ md`) or a full-screen takeover on mobile (`< md`) — with focus moved into the question input (UX-DR11, UX-DR19)

**Given** the panel is open
**When** the user submits a question
**Then** the question is sent to the existing ask endpoint and a confident-tier answer streams into the answer bubble token-by-token with a trailing cursor and "streaming…" caption (FR9, UX-DR14)
**And** a clarify- or refuse-tier response renders instantly with no streaming cursor, since no LLM call occurs for those tiers

**Given** a confident-tier answer has finished streaming
**When** its citations are attached
**Then** each citation is a real, keyboard-accessible link with an accessible name including the paper number, and no citation appears before the full response passes existing server-side citation verification (CAP-5)

**Given** a citation link is visible in the panel
**When** the user clicks it
**Then** the page navigates to that paper's Reader, scrolls to/highlights the quoted passage, and the quill panel collapses back to the launcher icon without clearing the conversation (UX-DR15)

**Given** WCAG 2.2 AA is the accessibility floor
**Then** the launcher and panel are fully keyboard-operable, tap targets are ≥ 44px, and the streaming answer bubble uses `aria-live="polite"` (UX-DR18)

**Given** an answer is streaming
**When** the connection drops or the stream otherwise fails to complete
**Then** the partial text already received stays visible with a quiet inline error state (e.g. "Connection lost — try asking again"), no auto-retry, and the send control re-enables so the user can resubmit (party-mode review, 2026-09-02)

### Story 5.2: Chat Persistence & Page-Aware Context

As a user having a research session across multiple pages,
I want my chat history to stay visible as I navigate, and have the widget automatically know which paper I'm reading (with the option to remove that context),
So that I don't lose my conversation or have to repeat context when asking a follow-up.

**Acceptance Criteria:**

**Given** an existing conversation in the current browser tab
**When** the user navigates to a different page (Browse Papers, a Paper Reader, etc.)
**Then** the chat history remains present next time the panel is opened, held in `sessionStorage` only — no network or database round-trip (FR8, NFR10)

**Given** the user closes the browser tab
**When** they reopen the app in a new tab
**Then** no prior chat history is restored — history is session-scoped, not persisted indefinitely (NFR10)

**Given** the user opens the quill panel while on a specific Paper Reader page
**When** the panel renders
**Then** a removable "📄 Federalist No. {N}" context chip appears at the top of the message list, pre-filled with that paper's title (UX-DR13)

**Given** the context chip is present
**When** the user submits a question
**Then** the ask request tells the LLM the user is currently reading that paper (number + title) as contextual framing only — retrieval still searches the whole archive; the current paper is never applied as a hard filter, so a question best answered by a different paper can still be (product correction, 2026-09-02: the original AC specified a `paperNumber` retrieval filter here — reusing the CAP-2/NFR6 filter-before-limit mechanism was the actual mechanism used before this correction — but that restricted answers to a single paper, which wasn't the intended user goal; "extra context, not a scope lock" is)

**Given** the context chip is present
**When** the user clicks its `✕`
**Then** the chip is removed, the next question no longer tells the LLM which paper the user is reading, and the chip does not reappear while the user remains on that same Paper Reader page — this is per-paper, not a one-time flag for the whole conversation

**Given** the chip was removed while reading Paper N
**When** the user navigates (e.g. via a citation or related-paper click) to a different Paper Reader, Paper M
**Then** the context chip re-evaluates fresh for Paper M and appears again — removal on Paper N does not suppress it on Paper M (party-mode review, 2026-09-02)

**Given** the panel is opened from the Homepage or Browse Papers, not a Paper Reader page
**Then** no context chip appears, and the input placeholder alone signals archive-wide scope

### Story 5.3: Related Papers in Chat

As a user who just got an answer to my question,
I want to see other papers related to what I asked about, right in the chat,
So that I can keep exploring the archive without needing a separate section on the main page.

**Supersedes Story 3.4** — same mechanism (reuse the retrieval already performed for the question, no separate call), new presentation (chat panel, not a main-page section).

**Acceptance Criteria:**

**Given** a confident-tier answer has finished streaming
**When** the retrieval call for that question returned papers beyond the ones actually cited
**Then** a "Related papers" list renders below the answer bubble, styled like citation links (oxblood, dotted-underline), listing those uncited papers from the same retrieval call (UX-DR20)
**And** no separate retrieval call is made to populate this list

**Given** the related-papers list is rendered
**When** the user clicks an entry
**Then** the page navigates to that paper's Reader with no passage highlight (it wasn't a cited passage), and the quill panel collapses back to the launcher icon — identical mechanics to a citation click, minus the highlight

**Given** a clarify- or refuse-tier response
**Then** no related-papers list renders

**Given** a confident-tier answer whose retrieval call returned no papers beyond the ones cited
**Then** the related-papers list section is omitted entirely — no empty placeholder shown
