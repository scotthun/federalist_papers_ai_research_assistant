---
title: 'Split the README architecture diagram into two user-journey diagrams'
type: 'docs'
created: '2026-09-06'
status: 'ready-for-dev'
context: []
baseline_revision: '6be33db'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `README.md`'s single combined Mermaid architecture diagram (from
spec-repo-readme-and-architecture.md) crams the "browse/search the archive" request path and the
"ask a question in the chat widget" request path into one flowchart. They're genuinely two
different user journeys through mostly-different components, and combining them makes the diagram
harder to read at a glance than either journey would be on its own.

**Approach:** Replace the single diagram with **two** Mermaid diagrams, each scoped to one journey:

1. **"Browse & Search the Archive"** — the CRUD-ish journey: Browse Papers / Search / Paper Reader
   pages, `PapersController`'s three endpoints (`/api/papers`, `/search`, `/search/semantic`),
   `libs/retrieval` (used only by the semantic-search endpoint), `libs/database`, the Postgres
   tables, and the one-time ingestion pipeline (`libs/documents` → `libs/ai` embedding → Postgres)
   that populates the data this journey reads. Ingestion belongs here, not in the chat diagram --
   it's how the data got there, not part of a live chat request.
2. **"Ask the Archive (chat widget)"** — the RAG journey: the Quill widget, the `/api/ask` NDJSON
   streaming proxy, `AskController`/`AskService`, `libs/ai` (query embedding + generation),
   `libs/retrieval`, and the already-populated `document_chunks` table it searches. No ingestion
   pipeline in this diagram -- it depends on `document_chunks` already existing, full stop.

`libs/shared` (compile-time type sharing between web/api) is dropped from both diagrams --
it was an unconnected node in the original combined diagram (no runtime request ever flows through
it), and a request-journey diagram should only show runtime component/data flow.

## Boundaries & Constraints

**Always:**
- Two separate ```mermaid fenced blocks in `README.md`'s existing "Architecture" section,
  replacing the current single diagram -- not added alongside it.
- Every component/edge in each diagram must be verified directly against the current codebase
  (same standard as the original diagram's spec) -- `PapersController`'s actual routes,
  `AskService`'s actual dependencies, `libs/documents`' actual role in ingestion only.
- Each diagram must independently render (Mermaid CLI or GitHub's own renderer) before this is
  done -- verified, not assumed from syntax.
- The surrounding prose (the "Request flow for a question asked in the chat widget" numbered list)
  stays associated with the chat diagram; a short parallel description is added for the
  browse/search diagram so both journeys get equal explanatory treatment, not just the chat one.

**Never:**
- No new component that doesn't already exist in the codebase today.
- No change to the rest of `README.md` (Tech stack, Quickstart, Demo, License sections) beyond
  what's needed to accommodate two diagrams instead of one.

## I/O & Edge-Case Matrix

| Scenario | Expected Behavior |
|----------|-------------------|
| Browse/Search diagram alone | Shows Browse/Search/Paper Reader pages → `PapersController` → (`libs/retrieval` for semantic search only) → `libs/database` → Postgres, plus the ingestion pipeline feeding that same Postgres data |
| Chat diagram alone | Shows the Quill widget → `/api/ask` proxy → `AskController`/`AskService` → `libs/ai` (embed + generate) + `libs/retrieval` → Postgres `document_chunks`, with no ingestion pipeline present |
| Both diagrams rendered independently | Each renders cleanly on its own (verified via Mermaid CLI), no shared/cross-referenced node between the two fenced blocks |
| `libs/shared` | Absent from both diagrams (no runtime edge into or out of it in either journey) |

</frozen-after-approval>

## Code Map

- `README.md` -- the "Architecture" section: replace the single diagram + its trailing numbered
  "Request flow" list with two diagrams, each followed by its own short flow description.

## Tasks & Acceptance

- [ ] Verify `PapersController`'s routes and `AskService`'s dependencies directly against current
      code before drawing either diagram.
- [ ] Write the "Browse & Search the Archive" diagram + short flow description.
- [ ] Write the "Ask the Archive (chat widget)" diagram + its flow description (the existing
      numbered list, relocated/adjusted as needed).
- [ ] Render-check both diagrams independently (Mermaid CLI).

**Acceptance:** `README.md`'s Architecture section has exactly two Mermaid diagrams, each scoped to
one journey as described above, both verified to render, with no loss of the explanatory prose the
single diagram previously had.

## Verification

Render each diagram independently via `@mermaid-js/mermaid-cli` (or equivalent) -- both must
produce valid output with no syntax errors. No test/build/lint impact -- documentation only.

## Suggested Review Order

1. `README.md`'s "Browse & Search the Archive" diagram -- checked against `PapersController`'s
   actual routes and `libs/documents`' actual ingestion role.
2. `README.md`'s "Ask the Archive (chat widget)" diagram -- checked against `AskService`'s actual
   dependencies (unchanged from the original diagram's already-verified chat-path edges).
