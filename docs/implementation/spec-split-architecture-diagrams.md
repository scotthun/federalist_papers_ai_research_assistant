---
title: 'Split the README architecture diagram into two user-journey diagrams'
type: 'docs'
created: '2026-09-06'
status: 'done'
context: []
baseline_revision: '6be33db'
followup_review_recommended: true
deferred:
  - summary: 'No discussion of failure/error paths (Gemini timeout during embedding/generation, citation-verification failure) anywhere in the Architecture section.'
    evidence: 'blind-hunter review, 2026-09-06'
    location: 'README.md -- Architecture section'
    severity: 'low'
  - summary: 'Confidence-tier thresholds described only qualitatively, with no pointer to where the actual cutoffs live in code.'
    evidence: 'blind-hunter review, 2026-09-06'
    location: 'README.md -- Architecture section'
    severity: 'low'
  - summary: 'The /api/ask route handler''s purpose as a proxy (rather than the Quill widget calling AskController directly) is asserted but never justified.'
    evidence: 'blind-hunter review, 2026-09-06'
    location: 'README.md -- Architecture section'
    severity: 'low'
  - summary: 'The "Ask the Archive" diagram omits libs/database/federalist_papers, but the ask flow''s "paper''s number as prompt context" isn''t documented as requiring (or not requiring) any lookup/validation against paper data.'
    evidence: 'blind-hunter review, 2026-09-06'
    location: 'README.md -- Architecture section'
    severity: 'low'
  - summary: 'No documentation of ingestion''s behavior on partial failure (resumability, idempotency) despite being a required one-time Quickstart step.'
    evidence: 'blind-hunter review, 2026-09-06'
    location: 'README.md -- Quickstart / Architecture section'
    severity: 'low'
  - summary: 'Only one edge in either diagram ("/search/semantic only") uses an inline conditional label, while other real conditional behavior (e.g. confidence-tier branching) is not labeled the same way -- inconsistent diagramming convention, not incorrect.'
    evidence: 'blind-hunter review, 2026-09-06'
    location: 'README.md -- Architecture section'
    severity: 'low'
  - summary: 'No cross-reference from the Architecture section to the docs/implementation/spec-*.md paper trail for readers who want the "why" behind a given component boundary.'
    evidence: 'blind-hunter review, 2026-09-06'
    location: 'README.md -- Architecture section'
    severity: 'low'
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

- [x] Verify `PapersController`'s routes and `AskService`'s dependencies directly against current
      code before drawing either diagram.
- [x] Write the "Browse & Search the Archive" diagram + short flow description.
- [x] Write the "Ask the Archive (chat widget)" diagram + its flow description (the existing
      numbered list, relocated/adjusted as needed).
- [x] Render-check both diagrams independently (Mermaid CLI).

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

## Review Triage Log

### 2026-09-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5 (high 0, medium 1, low 4)
- defer: 7 (high 0, medium 0, low 7)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` The "Ask the Archive" diagram drew `AskService --> Ai` as a flat edge alongside `AskService --> Retrieval`, implying `AskService` calls `libs/ai` directly for embedding -- confirmed against source (`libs/retrieval/src/lib/retrieval.ts`) that embedding happens *inside* `libs/retrieval`'s own `retrieveRelevantChunks`, and `AskService` only calls `libs/ai` directly for generation. Fixed by adding a `Retrieval --> Ai` edge (matching the Browse/Search diagram's already-correct nesting) and labeling `AskService --> Ai` as `"generation only"` to disambiguate (intent-alignment auditor, confirmed against `libs/retrieval/src/lib/retrieval.ts:94`).
  - `[low]` `[patch]` The Browse/Search diagram's `PapersController` label listed only 3 routes while the new prose enumerates 4 (missing `/:paperNumber`) -- added it to the label (edge-case-hunter).
  - `[low]` `[patch]` The Browse/Search diagram's `Ai` node label ("EmbeddingProvider abstraction") could read as if `libs/ai`'s interface itself lacks a generation half, rather than "generation isn't invoked in this journey" -- relabeled to "embedding half of the EmbeddingProvider/GenerationProvider abstraction" (blind-hunter).
  - `[low]` `[patch]` New prose used a bare `--` in two places while the rest of the README consistently uses an em dash `—` -- fixed both occurrences (blind-hunter).
  - `[low]` `[patch]` Neither diagram noted that several nodes (`Browser`, `libs/retrieval`, `libs/ai`, `Gemini`, `document_chunks`) are the same real components repeated across both diagrams, not coincidentally similar -- added one clarifying sentence to the intro paragraph (blind-hunter).

Deferred (pre-existing gaps, not introduced by this diff, out of this docs-restructuring story's scope):
- No discussion of failure/error paths (Gemini timeout during embedding/generation, citation-verification failure) anywhere in the Architecture section.
- Confidence-tier thresholds described only qualitatively, with no pointer to where the actual cutoffs live in code.
- The `/api/ask` route handler's purpose as a proxy (rather than the Quill widget calling `AskController` directly) is asserted but never justified.
- The "Ask the Archive" diagram omits `libs/database`/`federalist_papers`, but the ask flow's "paper's number as prompt context" isn't documented as requiring (or not requiring) any lookup/validation against paper data.
- No documentation of ingestion's behavior on partial failure (resumability, idempotency) despite being described as a required one-time Quickstart step.
- Only one edge in either diagram (`/search/semantic only`) uses an inline conditional label, while other real conditional behavior (e.g. confidence-tier branching) isn't labeled the same way -- inconsistent diagramming convention, not incorrect.
- No cross-reference from the Architecture section to the `docs/implementation/spec-*.md` paper trail for readers who want the "why" behind a given component boundary.

Rejected:
- Diagram 1 shows `Retrieval --> Database` while diagram 2 omits `libs/database` entirely (`Retrieval --> Chunks` direct) -- this is spec-mandated: the frozen I/O matrix explicitly prescribes `Database` for the browse/search diagram and its absence for the chat diagram. Not a defect.
- Ingestion arguably being a third "journey" deserving its own diagram -- the frozen intent explicitly resolved this ("Ingestion belongs here [diagram 1], not in the chat diagram"), so this is relitigating a decision already made by the intent, not new information.
- No change proposed to the Tech Stack section to cross-link the diagram's nuance -- explicitly out of scope per the frozen spec's Never clause ("No change to the rest of `README.md` ... beyond what's needed to accommodate two diagrams").
- `PapersService` fully elided into the `PapersController` node -- pre-existing simplification convention, unchanged from the original single diagram.
- `Retrieval --> Database` glosses over `libs/retrieval` using raw SQL against the injected `DataSource` rather than `libs/database`'s TypeORM entity layer -- pre-existing simplification, spec-mandated edge, not introduced by this diff.
- Intent-alignment's observation that no verification *artifact* (render log, screenshot) accompanies the diff -- the frozen spec's Verification section only requires the render check be performed, not that an artifact be embedded in the PR; independently re-verified in this pass (see Auto Run Result).

## Auto Run Result

**Summary:** Replaced `README.md`'s single combined architecture diagram with two Mermaid diagrams, one per user journey (Browse & Search, and the chat widget), per the frozen spec. Both independently verified to render. One substantive correctness patch applied post-review (the chat diagram's `AskService`/`libs/ai` edge misrepresented which component actually calls the embedding provider), plus four low-severity clarity/consistency patches.

**Files changed:**
- `README.md` -- Architecture section rewritten: two `###`-headed diagrams replacing the one combined diagram, each with its own short flow-description paragraph.

**Review findings:** 5 patched (1 medium, 4 low), 7 deferred, 6 rejected. See Review Triage Log above.

**Follow-up review recommended:** `true` (score: 3×1 medium + 1×4 low = 7, ≥ 5).

**Verification performed:** Both diagrams extracted from `README.md` and independently rendered via `@mermaid-js/mermaid-cli` before and after the patch pass -- both produce valid SVG output with no syntax errors. Every component/edge cross-checked directly against source (`apps/api/src/app/papers/papers.controller.ts`, `apps/api/src/app/ask/ask.controller.ts`/`ask.service.ts`, `libs/retrieval/src/lib/retrieval.ts`, `apps/web/src/app/api/ask/route.ts`). No test/build/lint impact -- documentation only.

**Residual risks:** None blocking. The deferred items above are real but pre-existing or explicitly out of this story's scope; none affect the accuracy of what the two diagrams now show.
