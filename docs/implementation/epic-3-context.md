# Epic 3 Context: Ask the Archive

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let users ask a natural-language question and get back a grounded, cited, confidence-tiered answer, then click any citation to land on the right paper with the passage shown in context. This is the project's flagship capability — it builds directly on Epic 2's retrieval layer by adding the answer-generation orchestration, confidence-tiering, and citation-verification logic that turns raw similarity-scored chunks into a trustworthy response, and it completes the AI provider abstraction (generation half) and the chunkId-ephemerality handling that earlier epics only partially covered.

## Stories

- Story 3.1: Confident Answer Generation
- Story 3.2: Clarify and Refuse Tiers
- Story 3.3: Navigate from a Citation to Its Passage
- Story 3.4: Related Papers

## Requirements & Constraints

- Three code-decided tiers, gated purely on the top retrieved chunk's similarity score, never the LLM's self-reported confidence: **confident** (score ≥ `confidentThreshold`) → full grounded LLM generation; **clarify** (`clarifyThreshold` ≤ score < `confidentThreshold`) → no LLM call, a templated best-guess response naming the likely paper, `confidence: "low"`, `insufficientEvidence: true`, one best-guess (unproven) citation; **refuse** (score < `clarifyThreshold`) → no LLM call, blanket "insufficient evidence" response, empty citations.
- The actual numeric values for `confidentThreshold`/`clarifyThreshold` are not fixed anywhere in planning docs — they require an empirical sweep against the retrieval evaluation dataset (built in Story 2.2) once real scores are observable. Treat this as a real blocking unknown for 3.1/3.2, not a pre-existing constant to look up.
- Every substantive answer's citations must be verified server-side against the chunk IDs actually retrieved for that request, in every tier including "confident" — this verification, not the threshold, is the real safety net against hallucinated sources. On a `chunkId` that fails verification: retry the LLM call once with an explicit correction listing the invalid ID(s) and the valid set; if the retry still fails, fail safe to the insufficient-evidence response. Never silently strip just the bad citation — the surrounding prose may still be making the claim it was backing.
- Per-request logging (query, retrieved paper numbers, similarity scores, model/provider used, latency, errors) is required for every answer request, extending the same lightweight pattern the Story 0.1 spike already established.
- Related Papers must reuse the single retrieval call already made to answer the question — no second retrieval call to populate it.
- Navigating from a citation must never re-fetch by `chunkId`; it uses the `paperNumber` and `quotedPassage` already held client-side from the answer response just received.

## Technical Decisions

- A single orchestrating service in `apps/api` (not a shared lib — promote to `libs/rag` only if a second real consumer of the orchestrator itself ever appears) composes `libs/retrieval` + `libs/ai`: reads the top score, decides the tier, and — only when a tier needs it — builds the grounded prompt (question, retrieved passages, per-passage source metadata, an explicit "answer only from this evidence" instruction, anti-hallucination system prompt) and runs citation verification.
- `libs/retrieval` (Epic 2) stays domain-naive — it already returns chunks with similarity scores only. All confidence-threshold interpretation belongs exclusively to this epic's orchestrator; retrieval itself is never modified to add it.
- The response shape is a Zod schema in `libs/shared`, single source of truth for both `apps/web` and `apps/api`: `{ answer, citations: [{ paperNumber, paperTitle, chunkId, quotedPassage?, relevanceExplanation? }], confidence: "high"|"medium"|"low", insufficientEvidence }`. `confidence` is always derived from the similarity score, never from the LLM.
- `libs/ai` gains its generation half (`generateAnswer`/`generateStructuredOutput`) alongside the `generateEmbedding` already in place from Epic 1/2 — the orchestrator depends only on this abstraction, never a provider SDK directly.
- `chunkId` is valid only for the one server-side verification round-trip within its originating request; it is never persisted, bookmarked, or looked up again afterward.
- Malformed/unvalidated LLM structured output, LLM failures, and "no relevant documents" are explicit handled error cases, not just the happy path.

## UX & Interaction Patterns

- Two-column desktop layout (responsive): left column holds the "Ask the Archive" question input (with example prompts) and the Answer; right column holds sources/citations/document context.
- The Answer section renders answer text, the confidence indicator, citations, and source passages together as one unit.
- Related Papers is a distinct section from the Answer's own citations — it surfaces other papers from the same retrieval call that weren't necessarily cited.
- Clicking a citation opens the Paper Reader **in the right-hand column only**, replacing whatever was already shown there — not an overlay, not a full-page navigation — and the left column (original question + answer) is never disturbed as a result. The cited passage displays above/beside the full paper text in that same right column (precise in-text highlighting is a nice-to-have, not worth sacrificing scope for).
- Overall aesthetic stays clean/academic, explicitly not a generic chat-UI look, across all of this epic's sections.

## Cross-Story Dependencies

- Stories 3.1 and 3.2 share one orchestrator entry point (the score check) — 3.2's clarify/refuse tiers aren't meaningfully separable from 3.1's confident tier.
- Story 3.3 depends on 3.1 producing real citations (`paperNumber` + `quotedPassage`) and extends Epic 1 Story 1.4's Paper Reader to render into the right column instead of a full navigation.
- Story 3.4 depends on 3.1/3.2's retrieval call already having happened; it cannot be built before the orchestrator exists to reuse.
- This epic is the first real consumer of Story 2.2's `retrieveRelevantChunks` and of `libs/shared`'s Zod schemas on the read path — Epic 2 built the mechanism, this epic is what actually calls it end-to-end.
