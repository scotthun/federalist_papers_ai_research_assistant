# Stack, Structure, and Operational Practices

Implementation prescription for the capabilities and constraints in `SPEC.md` — the HOW behind the WHAT.

## Technology stack

**Frontend:** Next.js, React, TypeScript, Tailwind CSS, shadcn/ui. Recharts only if a visualization becomes genuinely useful — do not add charting speculatively.

**Backend:** NestJS, TypeORM (query builder as needed, plus migrations), TypeScript.

**Database:** PostgreSQL + pgvector (see `data-model.md`; no separate vector database — SPEC.md Constraints).

**AI:** LangChain.js, TypeScript only, no Python. Provider-agnostic abstraction (below) so the app can switch between OpenRouter, OpenAI, Anthropic, Google Gemini, or another compatible provider without touching application/business logic.

**Validation:** Zod, for structured AI outputs and API boundaries.

**Testing:** Jest for backend/unit tests; standard React testing tools for the frontend. See `testing-approach.md`.

## Monorepo structure

Nx monorepo:

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

One library per concern — do not create a separate microservice per library.

## AI provider abstraction

Application code never depends directly on a single provider's SDK. Conceptual interface:

```
AIProvider
  - generateAnswer()
  - generateStructuredOutput()
  - generateEmbedding()
```

Implement at least one provider initially; adding a second should be straightforward. Provider selection is configurable via environment variables. Do not implement every provider up front just to prove the abstraction works.

## Local development commands

```
npm run db:migrate
npm run ingest:federalist-papers
npm run dev
```

## Chunking configuration

Ingestion chunking (see `data-model.md` for the `DocumentChunk` entity) uses a simple, defensible strategy — not sophisticated semantic chunking:

- Prefer paragraph/section boundaries.
- Target approximately 500–1,000 tokens per chunk.
- Modest overlap where useful.
- Never split mid-paragraph if reasonably avoidable.
- Chunk size is configurable, not hard-coded.

## Operational practices

**Error handling** — handle explicitly, with useful user-facing messages: LLM failures, embedding failures, database failures, no relevant documents, malformed LLM output, invalid citations (see `decisions.md`), rate limits.

**Observability** — lightweight logging only (not a full observability platform), around: query, retrieval count, retrieved paper numbers, similarity scores, model/provider used, latency, errors. Purpose: make retrieval-quality debugging easy, nothing more.

**Security** — never execute arbitrary LLM-generated code; never let the LLM generate arbitrary SQL for execution. The LLM only interacts with explicitly defined application capabilities. If natural-language database querying is ever added, use a constrained query interface or validated query generation — never blind execution of generated SQL.

## Implementation phases (suggested sequencing)

1. **Repository setup** — Nx monorepo, Next.js frontend, NestJS backend, shared libraries, TypeScript config, linting/testing.
2. **Database** — PostgreSQL, pgvector, schema, migrations, repository layer.
3. **Ingestion** — source acquisition (Avalon Project, see `decisions.md`), parser, chunker, metadata, embedding generation, database ingestion.
4. **Retrieval** — embedding query, pgvector similarity search, retrieval API, evaluation dataset, retrieval tests.
5. **RAG** — LLM provider abstraction, grounded prompt, structured output, citation validation, answer API.
6. **Frontend** — paper browser, document reader, search, Ask-the-Archive UI, citations, source display.
7. **Polish** — loading/error states, responsive UI, logging, tests, README, architecture documentation.

Spec-driven development throughout: inspect before building, make reasonable assumptions rather than stalling on every ambiguity, implement in small vertical slices, run tests after each slice, keep the app runnable continuously, refactor rather than accumulate complexity.
