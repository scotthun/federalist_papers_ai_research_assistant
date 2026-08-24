# Federalist Research — Draft Spec (pre-formalization)

> Raw input as provided by the project owner, ahead of running it through `bmad-spec` /
> `bmad-prd`. Preserved verbatim for review. Note: the source text was cut off mid-sentence
> in the README section — everything before that is complete.

You are the lead engineer responsible for designing and implementing a small portfolio project called "Federalist Research."

## PROJECT GOAL

Build a full-stack AI-powered research assistant for the Federalist Papers.

The application allows a user to:
1. Browse the 85 Federalist Papers.
2. Search the papers.
3. Ask natural-language questions about the papers.
4. Retrieve relevant passages from the Federalist Papers using RAG.
5. Generate an answer grounded ONLY in the retrieved source material.
6. Display citations linking each answer back to the relevant Federalist Paper and passage.
7. Open the source paper and see the cited passage in context.

This is primarily a learning/portfolio project demonstrating:
- RAG
- semantic search
- vector embeddings
- PostgreSQL + pgvector
- LangChain.js / TypeScript
- LLM tool orchestration
- structured LLM output
- React/Next.js
- Nx monorepo architecture
- provider-agnostic LLM architecture

The project should be intentionally small and polished rather than attempting to become a general-purpose historical research platform.

## IMPORTANT PRODUCT PRINCIPLES

1. The Federalist Papers are the source of truth.
2. The LLM must not be treated as the authoritative source of historical facts.
3. Answers should be grounded in retrieved passages.
4. Every substantive answer should include citations to the source papers.
5. If the system cannot find sufficient relevant evidence, it should explicitly say so rather than hallucinating.
6. Prefer deterministic application logic over asking the LLM to perform work that can be done reliably in code.
7. Do not over-engineer the system.
8. Do not build unnecessary infrastructure, authentication, user accounts, real-time updates, background job systems, microservices, or deployment infrastructure unless explicitly required.
9. The application should be easy for one engineer to understand and run locally.
10. Every paper must link to an independently verifiable, authoritative primary-source archive — a skeptical reader should be able to leave the app entirely and still confirm the text is real. *(Added via elicitation, 2026-08-24 — see SOURCE DECISION under DOCUMENT INGESTION.)*

## TECHNOLOGY STACK

Use an Nx monorepo.

Frontend:
- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Recharts only if a visualization becomes useful; do not add charting unless necessary.

Backend:
- NestJS
- TypeORM (orm query if needed and db migrations)
- TypeScript

Database:
- PostgreSQL
- pgvector

AI:
- LangChain.js
- TypeScript only
- Do NOT use Python.
- Build a provider-agnostic AI abstraction so the application can switch between OpenRouter, OpenAI, Anthropic, Google Gemini, or another compatible provider without changing application/business logic.

Validation:
- Zod for structured AI outputs and API boundaries where appropriate.

Testing:
- Jest for backend/unit tests
- React testing tools appropriate for the frontend

## MONOREPO STRUCTURE

Use a structure approximately like:

```
apps/
  web/
  api/

libs/
  ai/
  database/
  documents/
  retrieval/
  shared/
```

Do not create a separate microservice for every library.

## DATA MODEL

Create a database schema that supports at minimum:

FederalistPaper:
- id
- paperNumber
- title
- publicationDate if available
- sourceUrl (required, not optional — links to the authoritative source archive for independent verification; see SOURCE DECISION under DOCUMENT INGESTION)
- fullText
- createdAt
- updatedAt

Author:
- id
- name
- createdAt
- updatedAt

*(Kept minimal on purpose — no bio/portrait/birth-year fields yet, since nothing in this spec calls for an "About the Authors" feature today. This entity exists so that decision is cheap to make later: add columns here, not a schema redesign, if it ever becomes a real feature.)*

DocumentChunk:
- id
- paperId
- chunkIndex
- content
- embedding
- section/heading if available
- pageNumber if available
- metadata JSON if useful
- createdAt

### AUTHORSHIP DECISION (locked, 2026-08-24)

Authorship is a **many-to-many relationship** (`FederalistPaper` ↔ `Author`), not a string column on `FederalistPaper` — several papers have disputed or jointly-credited authorship (e.g. Nos. 18–20 are a Hamilton/Madison collaboration; Nos. 62–63 are long-disputed between the two). A single `author` string forces either an arbitrary pick or an unqueryable ad hoc value like `"Hamilton or Madison"`.

Implementation: a plain TypeORM `@ManyToMany` with an auto-managed join table (e.g. `federalist_paper_authors`) — no separate join-entity class needed, since the relationship itself carries no extra data (no role, no ordering). This was chosen over a simpler `author: string[]` array column specifically because a real `Author` entity gives authorship a proper home if it ever grows attached metadata, at the cost of one extra table and a join — a reasonable trade given the deliberate choice to model this correctly rather than cut the corner.

The relationships are:

FederalistPaper 1 → many DocumentChunks
FederalistPaper many ↔ many Author

The embedding model should be configurable.

Do not hard-code a specific embedding provider into the domain layer.

## DOCUMENT INGESTION

Create an ingestion process that:

1. Loads the Federalist Papers from a clearly defined source.
2. Parses the source into the 85 individual papers.
3. Cleans obvious formatting artifacts.
4. Preserves paper number, title, author, and other useful metadata.
5. Splits each paper into reasonable chunks.
6. Generates embeddings.
7. Stores papers and chunks in PostgreSQL.
8. Avoids duplicating documents if ingestion is run multiple times.

IMPORTANT:

Do NOT spend excessive effort building a sophisticated semantic chunking algorithm.

Use a simple, defensible strategy:
- Prefer paragraph/section boundaries.
- Target approximately 500–1,000 tokens per chunk.
- Use modest overlap where useful.
- Never split in the middle of a paragraph if it can reasonably be avoided.

The exact chunk size should be configurable.

Store enough metadata to make citations possible.

### SOURCE DECISION (locked, 2026-08-24)

**Ingestion source: the Avalon Project** (Yale Law School, Lillian Goldman Law Library) — `avalon.law.yale.edu/18th_century/fed{NN}.asp`, zero-padded 01–85. This URL doubles as the `sourceUrl` shown to end users for independent verification (product principle 10).

Chosen over Library of Congress, National Archives/Founders Online, and Congress.gov/GovInfo.gov after a `bmad-deep-recon` comparison (full report: `docs/planning/research/technical-federalist-papers-ingestion-source-2026-08-24/research.md`). Summary of why:
- Congress.gov/GovInfo.gov were eliminated outright — neither hosts the 85 papers as a standalone corpus, only citations to them inside an unrelated document.
- Avalon is the only candidate with all 85 papers on plain, uniform HTML, no auth wall, and a URL scheme independently verified (two separate research passes) to have been stable since 2008 — the strongest longevity evidence found.
- Founders Online has stronger academic pedigree (peer-reviewed critical editions) but failed direct automated fetching on every attempt tested — a real ingestion and live-link reliability risk.
- Known gap: Avalon publishes no provenance statement of its own (no named source edition or transcriber). Mitigated by an empirical fidelity check — 3 papers / 8 passages spot-checked word-for-word against Library of Congress's documented text came back essentially verbatim (one trivial OCR-level discrepancy). Treat this as evidence, not certainty: if it ever matters more than it does today, a larger-sample re-check is cheap.

**Pivot strategy, if a better-sourced archive shows up later:** this is a normal re-ingestion run, not a migration, *as long as ingestion is built idempotent and keyed by `paperNumber` from day one* (already required by ingestion step 8 above): update the `FederalistPaper` row's `fullText`/`sourceUrl`/metadata in place on its existing primary key, delete that paper's `DocumentChunk` rows, re-chunk and re-embed. For 85 papers (a few hundred to ~2,000 chunks total) that's minutes and pocket change in embedding-API cost, no schema change, no vector column/index rebuild. The one genuinely expensive migration is swapping the **embedding model or dimension** — that forces a vector column and index rebuild and is a separate concern from swapping the text source.

## RAG PIPELINE

Implement a retrieval pipeline:

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

Start with vector similarity retrieval.

Keep the retrieval interface abstract enough that hybrid search or reranking can be added later without rewriting the application.

The retrieval service should expose something conceptually like:

`retrieveRelevantChunks(query, options)`

where options can include:
- topK
- paperNumber
- author
- confidentThreshold / clarifyThreshold (see CONFIDENCE TIERING DECISION under ANSWER GENERATION — replaces a single `similarityThreshold`)

Do not implement advanced reranking unless it provides clear value and can be implemented simply.

## ANSWER GENERATION

The LLM should receive:

1. The user's question.
2. The retrieved source passages.
3. Metadata identifying each source.
4. Explicit instructions to answer only from the supplied evidence.

The system prompt should strongly discourage hallucination.

If the retrieved evidence does not sufficiently answer the question, the model should say something like:

"I couldn't find sufficient evidence in the Federalist Papers to answer that confidently."

The model should NOT invent citations.

Use structured output rather than asking the model to return arbitrary text formatting.

Define a schema similar to:

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

Validate the model output with Zod.

Citation IDs must correspond to actual retrieved chunks.

The backend must verify that returned citation IDs belong to the retrieved context before returning them to the frontend.

Do not trust the LLM to invent arbitrary document identifiers.

### CITATION VERIFICATION FAILURE HANDLING (locked, 2026-08-24)

Verification is a deterministic set-membership check, not an AI judgment call: the backend already knows the exact set of chunk IDs sent to the LLM as context, so checking a returned `chunkId` is a plain lookup against that known list — no model call needed to do the check itself.

When a returned citation's `chunkId` is not in that set (the LLM garbled or fabricated an ID — a documented LLM failure mode, not hypothetical; the same category of error as the well-publicized cases of lawyers submitting fabricated case citations from ChatGPT):
1. **Retry once** — re-send the same question and context to the LLM with an explicit correction: which ID(s) were invalid, and the full list of valid IDs, asking it to regenerate using only those.
2. **If the retry still returns an invalid citation, fail safe** — return the same "insufficient evidence" fallback response used elsewhere, rather than silently stripping the bad citation and serving the rest of the answer. Stripping is explicitly rejected: the answer's prose may still be making the claim that citation was backing, so removing only the citation produces an answer that *looks* fully verified but isn't — a worse trust violation than an honest fallback.

### CHUNK ID LIFETIME (locked, 2026-08-24)

A `chunkId` is valid only within the request/response cycle that produced it — never a stable, bookmarkable, or shareable identifier. Per the SOURCE DECISION pivot strategy, re-ingestion deletes and recreates `DocumentChunk` rows, so a `chunkId` a user might see today is not guaranteed to resolve to anything after a future re-ingestion run. Do not build any feature (e.g. a "shareable citation link") that persists or shares a raw `chunkId` outside its originating response.

### CONFIDENCE TIERING DECISION (locked, 2026-08-24)

Retrieval confidence drives a three-tier response, entirely decided in code — never by asking the LLM to self-report confidence (principle 6). Two configurable similarity thresholds on the top retrieved chunk's score, `confidentThreshold` and `clarifyThreshold`, gate the outcome:

- **Score ≥ `confidentThreshold`** — proceed to normal generation: call the LLM with the retrieved passages, generate a full grounded answer. `confidence` is derived from where the score falls, never from the LLM's self-report. Citations attached and server-verified as already required above.
- **`clarifyThreshold` ≤ score < `confidentThreshold`** — do not call the LLM for generation. Return a templated, code-generated response naming the best-guess paper (e.g. "I think you might be asking about Federalist No. 51, but I'm not confident enough to answer directly — can you add more detail?"), with `insufficientEvidence: true`, `confidence: "low"`, and a single citation entry representing the best-guess candidate rather than a proven source.
- **Score < `clarifyThreshold`** — the blanket "I couldn't find sufficient evidence..." response, `insufficientEvidence: true`, empty citations.

Why: validated via `bmad-deep-recon` (full report: `docs/planning/research/technical-rag-confidence-tiering-2026-08-24/research.md`). No production RAG system was found using this exact three-way similarity gate — most use a single binary cutoff — but the pattern itself is well-established in adjacent conversational-AI systems (Rasa, Amazon Lex use identical high/medium/low confidence banding for intent recognition, not RAG). Research surfaced a real caveat worth internalizing: a high similarity score does not guarantee a correct or complete answer — retrieved-but-marginal context can increase hallucination risk rather than trigger correct refusal. This is exactly why citation-ID server-side verification stays mandatory in *every* tier, including "confident" — it's the actual safety net, not the threshold.

**Threshold values are deliberately not fixed here.** No universal cosine-similarity cutoff exists across embedding models/datasets — calibrate empirically using the retrieval evaluation dataset (see TESTING): sweep candidate values for `confidentThreshold`/`clarifyThreshold` and pick what actually separates "expected paper retrieved" from "not retrieved" for your specific embedding model, rather than hard-coding a guessed number.

Explicitly out of scope (disproportionate engineering effort for this project): a trained relevance classifier (CRAG-style) or a full groundedness-scoring pipeline (RAGAS-style) as the confidence signal.

## CITATIONS

Citations are a major product feature.

Every citation should allow the user to navigate to:

Federalist Paper #X

and see:

- paper title
- author
- full text
- highlighted or clearly identified relevant passage if practical

If precise text highlighting becomes unnecessarily complicated, initially display the cited passage above/beside the full document.

Do not sacrifice project scope for sophisticated text highlighting.

### VERIFICATION LINK PLACEMENT (locked, 2026-08-24)

The `sourceUrl` link (product principle 10) lives as a **quiet tag near the paper title** on the Paper Reader page (e.g. "Source: Avalon Project ↗"), not inline at every cited passage and not in a separate drawer.

Why: Avalon's pages have no internal anchors — confirmed by inspecting the raw HTML of a live page — so the link can only ever land a reader at the *top* of the whole paper, never at the specific cited sentence. Since the link can't prove passage-level accuracy no matter where it's placed, putting it prominently next to a specific citation would misrepresent what it actually does. Its real job is narrower: institutional legitimacy ("this whole document is real and here's where it came from"), not sentence-level proof. A quiet, title-adjacent placement matches that honestly, and most readers won't need it most of the time anyway.

Sentence-level trust (does *this* citation actually say what the answer claims) is carried entirely by the app's own citation display — the retrieved chunk text already shown alongside the answer — not by the external link.

## SEARCH

Implement a basic document search interface.

Users should be able to search for:

- paper number
- author
- title
- exact keywords
- semantic concepts

At minimum provide:
- keyword/full-text search
- semantic search

If hybrid search is easy to implement with PostgreSQL, support it.

Do not introduce Elasticsearch or another search database.

## UI

Build a polished but simple research-oriented interface.

Main page:

Header:
"Federalist Research"
Subtitle:
"Explore the Federalist Papers with source-grounded AI."

Main sections:

1. Ask the Archive

A prominent question input.

Example questions:
- "What arguments does Madison make about factions?"
- "What does Hamilton argue about the executive?"
- "How does Federalist No. 51 describe checks and balances?"
- "Which papers discuss the judiciary?"

2. Answer

Display:
- answer
- confidence indicator
- citations
- source passages

3. Related Papers

Show papers related to the question.

4. Browse Papers

Allow browsing all 85 papers.

Paper list should display:
- number
- title
- author

5. Paper Reader

Show:
- paper number
- title
- author
- complete text
- cited passages when accessed from an answer

## DESIGN

Use a clean academic/research aesthetic.

Avoid making it look like a generic ChatGPT clone.

The UI should emphasize:
- documents
- citations
- source transparency
- readability

A two-column research layout is preferred on desktop:

Left:
- search / questions
- answer

Right:
- sources / citations / document context

Make the application responsive.

## AI PROVIDER ABSTRACTION

Create a provider abstraction such that application code does not directly depend on OpenAI or Anthropic APIs.

Conceptually:

```
AIProvider
  - generateAnswer()
  - generateStructuredOutput()
  - generateEmbedding()
```

Implement at least one provider initially.

Make adding another provider straightforward.

The provider should be configurable through environment variables.

Do NOT implement every provider initially just to prove the abstraction works.

## DATABASE / VECTOR SEARCH

Use PostgreSQL with pgvector.

Do not introduce Pinecone, Weaviate, Pinecone, Chroma, Qdrant, or another vector database.

The point of the project is to demonstrate that vector search can live alongside relational application data in PostgreSQL.

Create migrations and a straightforward local development setup.

Provide seed/ingestion commands.

Example:

```
npm run db:migrate
npm run ingest:federalist-papers
npm run dev
```

## TESTING

Testing is important.

Create unit/integration tests for:

1. Document parsing
2. Chunking
3. Duplicate-safe ingestion
4. Vector retrieval
5. Citation validation
6. RAG answer generation where practical
7. API endpoints
8. Important UI behavior

Create a small retrieval evaluation dataset.

For example:

```
[
  {
    question: "What does Federalist No. 10 say about factions?",
    expectedPapers: [10]
  },
  {
    question: "What arguments are made for a single executive?",
    expectedPapers: [67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77]
  }
]
```

Build a simple evaluation script that reports whether an expected paper appears in the top K retrieved chunks.

This is important because retrieval quality is more important than simply demonstrating that an LLM can answer questions.

## ERROR HANDLING

Handle:

- LLM failures
- embedding failures
- database failures
- no relevant documents
- malformed LLM output
- invalid citations
- rate limits

The user should receive useful error messages.

## SECURITY

Do not execute arbitrary code generated by the LLM.

Do not allow the LLM to generate arbitrary SQL for execution.

The LLM should only interact with explicitly defined application capabilities.

If natural-language database querying is eventually added, use a constrained query interface or validated query generation rather than blindly executing generated SQL.

## OBSERVABILITY

Add lightweight logging around:

- query
- retrieval count
- retrieved paper numbers
- similarity scores
- model/provider used
- latency
- errors

Do not build a full observability platform.

The purpose is to make it easy to debug retrieval quality.

## OUT OF SCOPE

Do NOT implement:

- authentication
- user accounts
- payments
- social features
- collaborative annotation
- arbitrary PDF uploads
- arbitrary web scraping
- a general-purpose agent framework
- autonomous web browsing
- multi-agent systems
- fine-tuning
- model training
- sophisticated semantic chunking
- complex reranking infrastructure
- Elasticsearch
- a separate vector database
- Kubernetes
- production cloud infrastructure
- mobile application

These can be future ideas but should not be part of the MVP.

## DEVELOPMENT APPROACH

Use spec-driven development.

Before writing significant implementation code:

1. Inspect the repository.
2. Produce a concise technical specification.
3. Identify ambiguities and make reasonable assumptions rather than constantly asking for confirmation.
4. Break the implementation into small vertical slices.
5. Implement one slice at a time.
6. Run tests after each meaningful slice.
7. Keep the application runnable throughout development.
8. Refactor when appropriate rather than accumulating unnecessary complexity.

Suggested implementation phases:

PHASE 1 — Repository setup
- Nx monorepo
- Next.js frontend
- NestJS backend
- shared libraries
- TypeScript configuration
- linting/testing

PHASE 2 — Database
- PostgreSQL
- pgvector
- schema
- migrations
- repository layer

PHASE 3 — Federalist Papers ingestion
- source acquisition
- parser
- chunker
- metadata
- embedding generation
- database ingestion

PHASE 4 — Retrieval
- embedding query
- pgvector similarity search
- retrieval API
- evaluation dataset
- retrieval tests

PHASE 5 — RAG
- LLM provider abstraction
- grounded prompt
- structured output
- citation validation
- answer API

PHASE 6 — Frontend
- paper browser
- document reader
- search
- ask-the-archive UI
- citations
- source display

PHASE 7 — Polish
- loading/error states
- responsive UI
- logging
- tests
- README
- architecture documentation

## README

Create a strong README explaining:

1. What the project does.
2. Why RAG is useful for this problem...

<!-- source text truncated here -->
