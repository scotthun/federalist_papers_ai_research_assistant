# Epic 2 Context: Search the Archive

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let users search the already-ingested archive by paper number, author, title, exact keyword, or semantic concept, with correct results for each mode — building directly on Epic 1's ingested data (papers, authors, chunks, embeddings) and introducing the retrieval layer that Epic 3's Q&A feature will later reuse. This epic proves relational search and vector search can coexist correctly in one system before any LLM-generation logic is added on top.

## Stories

- Story 2.1: Search by Number, Author, Title, or Keyword
- Story 2.2: Search by Semantic Concept

## Requirements & Constraints

- Each search mode (number, author, title, exact keyword, semantic concept) must return correct/relevant results, measured against the retrieval evaluation dataset.
- Searching by paper number returns the exact matching paper.
- Searching by author must correctly include joint/disputed authorship: e.g. searching "Madison" must return his solely-authored papers plus the jointly-authored Nos. 18–20 and the disputed Nos. 62–63 — not just papers with a single credited author.
- Title and exact-keyword search run as a direct relational query — no embeddings, no involvement of the semantic retrieval layer, and no separate search database introduced.
- Semantic search must embed the query and return the top-K most similar chunks with their similarity scores.
- Retrieval itself applies no confidence-threshold interpretation — it only returns scores; deciding what a score means (confident/clarify/refuse) is explicitly out of scope here and belongs to Epic 3.
- When a semantic search is combined with a `paperNumber` or `author` filter, that filter must apply in the SQL `WHERE` clause before the top-K `LIMIT` — never post-hoc on an already-limited result set.
- The retrieval evaluation script must be run against the sample eval dataset to confirm each question's expected paper appears in its top-K results.
- Hybrid (keyword + semantic) search is worth adding only if straightforward on top of this work — not a requirement for this epic.

## Technical Decisions

- Authorship is modeled many-to-many (`Author` ↔ `FederalistPaper`), not a string/array column — a plain TypeORM `@ManyToMany` with an auto-managed join table, established in Epic 1. Author search must query through this relation so joint/disputed papers surface correctly for every credited author.
- Architecturally, the search capability splits in two paths from an `apps/api` search endpoint: the semantic half calls `libs/retrieval`; the keyword/number/title half queries `libs/database` directly. No orchestrator is needed for the plain-filter path — that's a distinguishing feature from Epic 3's Q&A path, which does need one.
- `libs/retrieval` stays domain-naive: it composes `libs/database` (pgvector query) and `libs/ai` (query embedding) and returns chunks with similarity scores only — no concept of a confidence threshold, no citation logic. Its conceptual signature is `retrieveRelevantChunks(query, options)`, where `options` includes `topK`, `paperNumber`, `author` (confidence thresholds do not belong here — that logic lives only in Epic 3's `apps/api` orchestrator).
- Enforcing that `paperNumber`/`author` filters apply in the SQL `WHERE` clause before the `LIMIT` is retrieval's own responsibility to guarantee, distinct from (and not in tension with) staying domain-naive on confidence — filtering is a keyword-style constraint, not a score judgment.
- The leaf libs (`database`, `ai`, `documents`) never import from each other; `retrieval` depends on both `database` and `ai` for the read path.
- Embeddings and chunk storage already exist from Epic 1's ingestion (Story 1.2) — this epic performs no new ingestion, only reads. The query-side embedding call reuses the same swappable `libs/ai` provider abstraction (`generateEmbedding`) used at ingestion time.
- Validate the semantic path against the hand-built retrieval evaluation dataset (question → expected paper(s)); this is the same mechanism later used to calibrate Epic 3's confidence thresholds, but this epic only needs it to prove top-K correctness, not to pick threshold values.

## Cross-Story Dependencies

- Both stories depend on Epic 1's ingested data; Story 2.2 specifically depends on Epic 1 Story 1.2 having produced embeddings for all chunks.
- Stories 2.1 and 2.2 are independent of each other (relational vs. vector query paths) and can be built in either order.
- Story 2.2's `libs/retrieval` implementation is a direct dependency for Epic 3: the Q&A orchestrator will call the same `retrieveRelevantChunks` function and layer confidence-tiering and citation logic on top of the scores it returns, without modifying retrieval itself.
