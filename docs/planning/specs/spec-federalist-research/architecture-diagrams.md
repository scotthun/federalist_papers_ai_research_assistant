# Architecture Diagrams

## RAG pipeline flow

```
User question
    ↓
query embedding
    ↓
pgvector similarity search
    ↓
retrieve top K chunks
    ↓
optional metadata filtering
    ↓
construct grounded prompt
    ↓
LLM
    ↓
structured answer
    ↓
citations
```

Start with vector similarity retrieval. Keep the retrieval interface abstract enough that hybrid search or reranking can be added later without rewriting the application:

```
retrieveRelevantChunks(query, options)
```

`options` includes: `topK`, `paperNumber`, `author`. **Amended 2026-08-24 (architecture coaching):** `confidentThreshold`/`clarifyThreshold` do NOT belong here — retrieval stays domain-naive and has no concept of a confidence threshold (architecture spine `AD-7`). `retrieveRelevantChunks` returns chunks *with their similarity scores*; the caller (the orchestrating service in `apps/api`) reads the top score and applies the threshold logic itself. See `decisions.md`, "Confidence tiering" for the tier behavior, and the architecture spine for why this line moved out of retrieval.

`paperNumber`/`author` filters apply in the SQL `WHERE` clause before the top-K `LIMIT` — never post-hoc (SPEC.md Constraints). This filter-ordering rule is retrieval's own responsibility to enforce, distinct from the confidence-threshold decision above (a keyword-style filter, not a score judgment).

Do not implement advanced reranking unless it provides clear value and can be implemented simply.

Semantic (vector) search is the baseline; keyword/full-text search is also required (CAP-2). Hybrid search is in scope only if it's easy to implement with PostgreSQL's existing capabilities — not a hard requirement, and no separate search database (e.g. Elasticsearch) regardless.

## Prompt construction

The LLM receives, per request: the user's question, the retrieved source passages, metadata identifying each source, and an explicit instruction to answer only from the supplied evidence. The system prompt strongly discourages hallucination. The model must never invent citations — enforced by the verification step in `decisions.md`, not by prompt wording alone.

## Answer schema (structured output, Zod-validated)

```
Answer:
{
  answer: string,
  citations: [
    {
      paperNumber: number,
      paperTitle: string,
      chunkId: string,
      quotedPassage?: string,
      relevanceExplanation?: string
    }
  ],
  confidence: "high" | "medium" | "low",
  insufficientEvidence: boolean
}
```

`confidence` is derived from retrieval similarity score, never from the LLM's self-report (see `decisions.md`, "Confidence tiering"). Citation `chunkId`s are verified server-side against the actually-retrieved context before the response reaches the frontend (see `decisions.md`, "Citation verification").

**Navigating from a citation to its passage (CAP-6) never depends on `chunkId` persistence.** The frontend already holds `paperNumber` and `quotedPassage` from the answer it just received — it navigates to that paper's reader by `paperNumber` (a stable identifier) and displays/highlights the already-held `quotedPassage` text client-side. `chunkId` is used only for the one server-side verification round-trip (see `decisions.md`, "Chunk ID lifetime") and never needs to be looked up again afterward.

## Ingestion chunk DTO (write path)

Symmetric to the `Answer`/`Citation` schema on the read path: the shape of a parsed-and-chunked-but-not-yet-embedded passage, and the shape of a chunk-with-embedding-ready-to-store, are shared types living in `libs/shared` — imported by `libs/documents` (produces the first shape), `libs/ai` (consumes the first, produces an embedding), and `libs/database` (consumes the final shape for storage). This prevents the same kind of drift on the write path that a shared `Answer` schema prevents on the read path (see architecture spine `AD-9`).
