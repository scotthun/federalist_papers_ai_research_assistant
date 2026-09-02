---
id: SPEC-federalist-research
companions:
  - stack.md
  - data-model.md
  - architecture-diagrams.md
  - decisions.md
  - ui-design.md
  - testing-approach.md
  - ../research/technical-federalist-papers-ingestion-source-2026-08-24/research.md
  - ../research/technical-rag-confidence-tiering-2026-08-24/research.md
  - ../architecture/architecture-federalist_papers_ai_research_assistant-2026-08-24/ARCHITECTURE-SPINE.md
  - ../../ux-designs/ux-federalist_papers_ai_research_assistant-2026-08-29/DESIGN.md
  - ../../ux-designs/ux-federalist_papers_ai_research_assistant-2026-08-29/EXPERIENCE.md
sources:
  - ../draft-spec.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. `draft-spec.md` is listed for traceability only — consult it for narrative color this contract intentionally omits.

# Federalist Research

## Why

A vision to realize, doubling as a portfolio artifact: a small, polished RAG-based research assistant over the 85 Federalist Papers, built to demonstrate — to the engineer building it and to anyone reviewing the repo (hiring managers, other engineers) — real competence in RAG, semantic search, pgvector, provider-agnostic AI architecture, and structured LLM output, without inflating into a general-purpose historical research platform. It matters now because the primary author is actively building toward roles that require exactly this skill set, and because the project owner's own background (history major) makes source-fidelity and historiographic rigor a genuine constraint, not decoration.

## Capabilities

- **CAP-1: Browse**
  - **intent:** A user can browse a complete list of all 85 Federalist Papers, each showing number, title, and author(s).
  - **success:** The browse view lists exactly 85 entries; each links to its full Paper Reader.

- **CAP-2: Search**
  - **intent:** A user can search papers by paper number, author, title, exact keyword, or semantic concept.
  - **success:** Each search mode returns correct/relevant results, measured against the retrieval evaluation dataset.

- **CAP-3: Ask the Archive**
  - **intent:** A user asks a natural-language question and receives an answer grounded only in retrieved Federalist Papers passages.
  - **success:** No answer contains a claim without a server-verified citation backing it; the retrieval evaluation dataset's expected paper appears in the top-K retrieved chunks for its test questions.

- **CAP-4: Tiered confidence response**
  - **intent:** The system responds via one of three code-decided tiers — confident answer, clarify-with-best-guess, or refuse-insufficient-evidence — gated on retrieval similarity, never on the LLM's self-reported confidence.
  - **success:** Given fixture retrieval scores in each threshold band, the corresponding tier's response is produced deterministically, and the LLM is never invoked for generation below `clarifyThreshold`.

- **CAP-5: Verified citations**
  - **intent:** Every substantive answer includes citations (paper number, title, chunk) that are verified server-side against the chunks actually retrieved for that request before reaching the user.
  - **success:** Any citation reaching the frontend maps to a chunk ID retrieved for that request; a citation that fails verification triggers one LLM retry, then a safe fallback response — never a silently stripped citation served as if the remaining answer were still fully backed.

- **CAP-6: Passage-in-context navigation**
  - **intent:** A user can open a cited paper from its citation and see the cited passage in context.
  - **success:** Clicking a citation opens the correct paper's reader and surfaces the cited passage without discarding the original question and answer.

- **CAP-7: Independent source verification**
  - **intent:** A user can follow a link from any paper to its authoritative original source to independently verify the text, without relying on the app itself.
  - **success:** Every `FederalistPaper` row has a non-null, resolvable `sourceUrl`; the link is visibly present as a quiet tag near the paper title in the reader (see `ui-design.md`).

- **CAP-8: Persistent multi-question session**
  - **intent:** A user can ask multiple independent questions in a row via the quill chat widget, with visible history preserved across page navigation within the same browser tab, optionally scoped to the paper currently being read.
  - **success:** Chat history remains visible after navigating to a different page in the same tab and is cleared on tab close (sessionStorage only — see `decisions.md`); a question asked while viewing a specific paper's reader page defaults to filtering retrieval to that paper via a removable context chip.

- **CAP-9: Streaming answer delivery**
  - **intent:** A confident-tier answer's prose streams to the client token-by-token instead of arriving as one blocking response.
  - **success:** For confident-tier responses, partial text reaches the client before generation completes; citations attach only after the full response completes and passes existing server-side citation verification (CAP-5) — never a speculative or unverified per-token citation. Clarify/refuse tiers are unaffected (already instant, no LLM call).

## Constraints

- Postgres + pgvector only for vector search — no separate vector database. The point of the project is demonstrating vector search living alongside relational data in one system.
- AI layer is TypeScript-only via LangChain.js — no Python anywhere in the stack.
- No authentication or user accounts — bends rate-limiting toward IP/global throttling rather than per-user quotas, and rules out personalization.
- Nx monorepo: `apps/web`, `apps/api`, `libs/ai|database|documents|retrieval|shared` — one library per concern, not one microservice per library.
- Ingestion and citation source is locked to the **Avalon Project** (`avalon.law.yale.edu/18th_century/fed{NN}.asp`) — see `decisions.md` for the full research-backed rationale.
- Deterministic application logic is preferred over LLM judgment wherever code can decide reliably — governs confidence tiering, citation verification, and the `confidence` field's derivation (from similarity score, never LLM self-report). See `decisions.md`.
- `Author` is a many-to-many relation to `FederalistPaper`, not a string column, to represent disputed/joint authorship (e.g. Nos. 18–20, 62–63) without picking a side. See `data-model.md`.
- `chunkId` is ephemeral — valid only within its originating request/response cycle, never persisted, bookmarked, or shared as a stable identifier, since re-ingestion deletes and recreates `DocumentChunk` rows.
- Retrieval filters (`paperNumber`/`author`) must apply in the SQL `WHERE` clause before the top-K `LIMIT`, never applied post-hoc on an already-limited result set.
- An AI provider abstraction (`generateAnswer`/`generateStructuredOutput`/`generateEmbedding`) is mandatory — application code never depends directly on a single provider's SDK.
- Rate limiting: a per-IP throttle is required at MVP; a global daily cap on AI-backed requests is designed but deferred past MVP. No Redis needed at this project's single-process scale. See `decisions.md`. Every chat message counts as one request against these same counters, identical to a single-shot ask — no discount for messages within a conversation.
- Chat conversation state is client-side only (`sessionStorage`), never persisted server-side or in the database — consistent with no auth/user accounts (NFR1). Each chat message is a fully independent, stateless request to the ask endpoint; the backend holds no conversational memory.
- Page-aware context scoping (the chat's paper-context chip) reuses the existing `paperNumber` retrieval filter (CAP-2/NFR6) — not a new filtering mechanism.

## Non-goals

- Authentication, user accounts, payments, social or collaborative features.
- Arbitrary PDF upload or arbitrary web scraping.
- A general-purpose agent framework, autonomous browsing, or multi-agent systems.
- Fine-tuning or model training.
- Sophisticated semantic chunking or complex reranking infrastructure.
- Elasticsearch or any separate vector database.
- Kubernetes, self-managed cloud infrastructure, or custom DevOps/CI pipelines; mobile application. (A managed PaaS deploy target for the live demo — e.g. Vercel + a managed Postgres host — is in scope; see `decisions.md`, "Deployment target." The original intent was "no infra to operate," not "no hosting at all.")
- AI-driven UI generation — the app is a librarian pointing to documents, never an editor generating or altering the reading experience (see `decisions.md`, "librarian vs. editor").
- Server-side conversational memory or multi-turn context resolution (e.g. resolving "what about him?" against a prior turn) — each chat message must be self-contained. Deliberately deferred to keep scope minimal given no auth/user accounts to hang a persisted session on.

## Success signal

A user asks a real question (e.g. "What does Federalist No. 10 say about factions?"), receives an answer grounded in retrieved passages with server-verified citations, clicks through to the cited paper and sees the passage in context, and can independently verify the source via the Avalon Project link — end to end, runnable locally via `npm run db:migrate`, `npm run ingest:federalist-papers`, `npm run dev`.

## Assumptions

- Slug `federalist-research` inferred from the project's own stated name; not directly confirmed with the user (unambiguous, not asked).

## Open Questions

- Exact values for `confidentThreshold`/`clarifyThreshold` are deliberately unresolved here — they require empirical calibration against the retrieval evaluation dataset once an embedding model is chosen, not a research or spec-time decision (see `decisions.md`).
- Whether a lightweight reranker is worth adding later — not currently warranted, but worth revisiting only if real retrieval quality proves weaker than expected.
