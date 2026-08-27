---
title: 'Story 3.1: Confident Answer Generation (+ Story 3.2: Clarify and Refuse Tiers)'
type: 'feature'
created: '2026-08-26'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'd9d49ab41d2dd583685e3a8cbf9350343ef7d1d0'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 2 can find relevant passages, but a researcher still has to read them and synthesize an answer themselves. There's also no safety net against confidently-worded nonsense: an LLM asked to answer from evidence will do so even when the evidence is thin, and will invent citations if not checked.

**Approach:** Build the `apps/api` orchestrator that turns a retrieval call into a trustworthy answer: read the top similarity score, decide one of three tiers entirely in code, and only call the LLM for the confident tier — with every citation it returns verified against the actual retrieved chunk IDs before anything reaches the frontend. `libs/retrieval` and `libs/ai`'s embedding half are untouched; this story adds `libs/ai`'s generation half and the first real `Answer`/`Citation` Zod schema in `libs/shared`.

**Scope call:** GitHub tracks this as two stories (#8 confident tier, #9 clarify/refuse tiers), but they share one orchestrator entry point — the score check — and aren't separable at the code level: you cannot build "if confident, call the LLM" without deciding what the `else` does, and `decisions.md` already fully specifies both non-confident tiers' exact behavior (no design work left to defer). This spec and its implementation cover both; the resulting PR closes both #8 and #9. Frontend scope is deliberately minimal: a question input and an Answer section showing the answer, confidence, and a plain (not yet clickable) citation list — the two-column layout and citation-click-to-navigate behavior are Story 3.3's job, Related Papers is Story 3.4's.

## Boundaries & Constraints

**Always:**
- Three tiers, decided by comparing the top retrieved chunk's score against two constants (`CONFIDENT_THRESHOLD`, `CLARIFY_THRESHOLD`) in the `apps/api` orchestrator — never by asking the LLM to self-report confidence:
  - **Confident** (score ≥ `CONFIDENT_THRESHOLD`): call the LLM with the retrieved passages, source metadata, and an explicit "answer only from this evidence" instruction; verify every returned citation's `chunkId` against the actually-retrieved set.
  - **Clarify** (`CLARIFY_THRESHOLD` ≤ score < `CONFIDENT_THRESHOLD`): no LLM call. A code-generated response naming the top chunk's paper as a best guess, `confidence: "low"`, `insufficientEvidence: true`, one citation for that paper with no `quotedPassage`/`relevanceExplanation` (it's an unproven guess, not a verified source).
  - **Refuse** (score < `CLARIFY_THRESHOLD`): no LLM call. The blanket "I couldn't find sufficient evidence in the Federalist Papers to answer that confidently" response, `confidence: "low"`, `insufficientEvidence: true`, empty citations.
- `CONFIDENT_THRESHOLD`/`CLARIFY_THRESHOLD` are not given anywhere in the planning docs — they must be calibrated empirically this story, using real similarity scores observed against the retrieval evaluation dataset (extended with a handful of genuinely off-topic/unanswerable control questions so there's a real "should not be confident" signal to calibrate against, not just the existing all-hits dataset).
- `confidence` mapping: confident tier -> `"high"`; clarify and refuse tiers -> `"low"` (matching `decisions.md`'s explicit wording for clarify, extended to refuse since there's no textual basis for a fourth value). `"medium"` is schema-valid but not produced by any tier today — documented as a deliberate simplification in Design Notes, not an oversight.
- The LLM is only ever asked to produce `{ answer, citations }` (a new `LlmAnswerOutputSchema` in `libs/shared`) -- `confidence` and `insufficientEvidence` are always computed by the orchestrator from the score and merged in afterward, never requested from or accepted from the LLM's own output.
- Citation verification is a deterministic set-membership check (no model call) against the exact chunk IDs sent as context for that request. On a `chunkId` not in that set, or on malformed/schema-invalid LLM output: retry once with a fresh prompt containing the original context plus an explicit correction (the invalid ID(s) and the full valid set, or the parse error). If the retry also fails, fail safe to the refuse-tier response -- never silently strip just the bad citation.
- `libs/ai`'s `AIProvider` gains one new method, `generateStructuredOutput<T>({ systemInstruction, prompt, schema }): Promise<T>` -- a generic schema-validated structured-output call, implemented in `GeminiProvider` via `@google/genai`'s JSON-mode/structured-output support, with the returned JSON always re-validated against the passed Zod `schema` regardless of what the SDK's own schema hinting does. (Collapses the `generateAnswer`/`generateStructuredOutput` split named in the interface's existing pre-Epic-3 doc comment into this one method -- update that comment.)
- `POST /api/ask` (`AskController`/`AskService`/`AskModule`, same pattern as `PapersController`) takes `{ question: string }` and returns the full `Answer` shape (`{ answer, citations, confidence, insufficientEvidence }`). A blank/whitespace `question` is a 400 (a format error, distinct from "no evidence found," which is a content outcome, not a request error).
- Every request is logged (query, retrieved paper numbers, similarity scores, model/provider used, latency, errors), extending the Story 0.1 spike's logging pattern -- for every tier, not just the confident one.
- `chunkId`s in any response are never treated as stable/bookmarkable (`decisions.md`, "Chunk ID lifetime") -- this story doesn't build anything that persists or re-looks-up one.
- Frontend: a question input plus an Answer section (answer text, confidence indicator, `insufficientEvidence` messaging, and a plain citation list showing paper number/title/quoted passage where present) on the existing Browse Papers page or a new page -- render as a single functional unit, not yet the full two-column layout and not yet clickable citations.

**Ask First:** Any dependency, tool, or Nx workspace flag not already named in `stack.md` / the architecture spine / this spec -- including any package needed to convert a Zod schema to a JSON schema for Gemini's structured-output hint, if the implementation ends up needing one (plain prompt-described shape + post-hoc Zod validation is an acceptable fallback that needs no new dependency).

**Never:**
- LLM self-reported confidence, in any form.
- Citation navigation (clicking a citation to open the Paper Reader) or the two-column layout (Story 3.3).
- Related Papers (Story 3.4).
- Any change to `libs/retrieval`'s domain-naive contract -- it still returns chunks with scores only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Confident retrieval | Top score ≥ `CONFIDENT_THRESHOLD` | Grounded answer, verified citations, `confidence: "high"`, `insufficientEvidence: false` | N/A |
| Marginal retrieval | Top score in `[CLARIFY_THRESHOLD, CONFIDENT_THRESHOLD)` | No LLM call; best-guess-paper response, `confidence: "low"`, `insufficientEvidence: true` | N/A |
| No relevant evidence | Top score < `CLARIFY_THRESHOLD` | No LLM call; blanket insufficient-evidence response, empty citations | N/A |
| LLM returns a citation `chunkId` not in the retrieved set | Confident tier | One retry with an explicit correction; second failure falls back to the refuse-tier response | Never silently strips the bad citation |
| LLM returns malformed/schema-invalid structured output | Confident tier | Same retry-once-then-fail-safe as a bad citation | Never an uncaught crash |
| Blank/whitespace question | `question` empty | 400 | Never reaches retrieval or the LLM |
| Embedding/LLM provider call fails (e.g. missing `GEMINI_API_KEY`) | Any tier needing it | Clear error response | Never a hang |

</frozen-after-approval>

## Code Map

- `docs/planning/epics.md` (Stories 3.1 AC / #8, 3.2 AC / #9), `docs/implementation/epic-3-context.md` -- full tier behavior, cross-story dependency note on 3.1/3.2's shared entry point.
- `docs/planning/specs/spec-federalist-research/decisions.md` ("Confidence tiering," "Citation verification," "Chunk ID lifetime") -- the exact tier behaviors and retry policy, verbatim source for this spec's Boundaries.
- `docs/planning/specs/spec-federalist-research/architecture-diagrams.md` ("Prompt construction," "Answer schema") -- the exact `Answer`/`Citation` field shapes.
- `docs/planning/specs/spec-federalist-research/ui-design.md` -- confirms the Answer section's content list (answer, confidence, citations, source passages); the two-column layout itself is out of this story's scope.
- `docs/implementation/spec-2-2-search-by-semantic-concept.md` (status: done) -- `retrieveRelevantChunks`'s exact signature and score semantics (`1 - cosine_distance`, can be negative) this orchestrator calls directly. This story's branch is stacked directly on `story/2-2-search-by-semantic-concept` rather than waiting for PR #20 to merge; its own PR will need retargeting to `main` once #20 merges (GitHub does not auto-retarget a child PR when its base branch's PR merges first -- confirmed the hard way during Story 1.4).
- `libs/ai/src/lib/ai-provider.interface.ts` -- current `generateEmbedding`-only interface and its comment naming `generateAnswer`/`generateStructuredOutput` as reserved for this epic.
- `libs/ai/src/lib/providers/gemini.provider.ts` -- existing `GeminiProvider` shape/error-handling conventions (fail-fast on missing dimension, etc.) to match for the new method.
- `libs/shared/src/lib/paper-detail.ts` -- shows the existing convention of composing rather than redeclaring shared fields, and confirms (via its own doc comment) that AD-9's Zod-validation rule is scoped specifically to the `Answer`/`Citation` contract -- this is the first story that actually needs it.
- `apps/api/src/app/papers/` (Stories 1.3/1.4/2.1/2.2) -- the controller/service/module pattern to replicate for the new `ask/` module; `ai-provider.provider.ts`'s lazy DI wrapper is the pattern to reuse (or share) for injecting an `AIProvider` into this new module too.
- Story 0.1's spike (commit `9d1ae94`, `git show 9d1ae94:spike/src/answer.ts` and `git show 9d1ae94:spike/src/verify-citations.ts`) -- a proven, never-merged reference for the grounded-prompt/citation-verification shape, rebuilt here against the real `libs/` boundaries and the real `Answer` schema.

## Tasks & Acceptance

**Execution:**
- [ ] Confirm Story 2.2 (PR #20) is merged into `main` before branching -- this story imports `retrieveRelevantChunks` directly.
- [ ] `libs/shared/src/lib/answer.ts` -- `CitationSchema`, `LlmAnswerOutputSchema`, `AnswerSchema` (Zod), plus their inferred TS types.
- [ ] `libs/ai/src/lib/ai-provider.interface.ts` -- add `generateStructuredOutput`; update the interface's doc comment.
- [ ] `libs/ai/src/lib/providers/gemini.provider.ts` -- implement `generateStructuredOutput` via `@google/genai`'s structured-output support, always re-validating the parsed result against the passed Zod schema.
- [ ] Extend the retrieval evaluation dataset (or add a small companion dataset) with a handful of genuinely off-topic/unanswerable control questions, run `npm run eval:retrieval`-style scoring against them, and use the resulting score spread (on-topic vs. off-topic) to pick `CONFIDENT_THRESHOLD`/`CLARIFY_THRESHOLD` -- document the actual observed scores and chosen values in Design Notes.
- [ ] `apps/api/src/app/ask/` -- `AskController` (`POST /api/ask`), `AskService` (tier decision, prompt construction, citation verification + retry, logging), `AskModule`.
- [ ] Frontend: a question input + Answer section (answer, confidence, `insufficientEvidence` messaging, plain citation list) -- minimal, functional, not the two-column layout.

**Acceptance Criteria:**
- Given a question whose top retrieved chunk scores at or above `CONFIDENT_THRESHOLD`, the orchestrator calls the LLM with the retrieved passages/metadata and an "answer only from this evidence" instruction, returns `confidence` derived from the score (never LLM self-report), and every citation's `chunkId` is verified against the retrieved context (one retry on mismatch, then fail-safe) -- never silently stripped.
- Given a question whose top score is between `CLARIFY_THRESHOLD` and `CONFIDENT_THRESHOLD`, no LLM call happens; a best-guess-paper response is returned with `confidence: "low"`, `insufficientEvidence: true`.
- Given a question whose top score is below `CLARIFY_THRESHOLD`, no LLM call happens; the blanket insufficient-evidence response is returned with empty citations.
- Basic logging (query, retrieved paper numbers, similarity scores, model/provider, latency, errors) is emitted for every request.

## Spec Change Log

- 2026-08-26 -- Two rounds of code review, 17 findings total across 3 independent reviewers each round, all fixed, no spec-intent change.

  **Round 1 (12 findings, the safety-net-critical ones):** (1) Citation verification only checked `chunkId` set-membership -- it never confirmed a citation's `paperNumber`/`paperTitle` actually matched that chunk's real metadata, so a real `chunkId` with a fabricated paper title would have passed as "verified." Fixed with `finalizeCitations` in `ask.service.ts`, which re-derives `paperNumber`/`paperTitle` server-side from the matched retrieved chunk after verification passes, never trusting the LLM's echoed values for those two fields. (2) The zero-citations retry-correction message was nonsensical ("...do not exist in the evidence above: ." with no IDs named) -- fixed with a distinct `buildEmptyCitationsCorrection`. (3) `AskController` validated the trimmed question but forwarded the untrimmed one -- fixed. (4) The LLM was never actually asked to produce `quotedPassage`/`relevanceExplanation` despite the schema defining them and Story 3.3 depending on `quotedPassage` -- the system instruction now explicitly requires both per citation, and `CitationSchema`'s fields gained `.describe()` text so Gemini's JSON-schema hint carries real guidance. (5) `relevanceExplanation` was never rendered in the frontend -- fixed. (6)-(7) The clarify tier was untested at the real-HTTP layer and untested in the frontend against its actual shape (`insufficientEvidence: true` with a *non-empty* citations array) -- both gaps closed; the frontend gap was a real regression risk since both prior fixtures happened to correlate `insufficientEvidence` with citations-emptiness. (8) The frontend's hand-rolled `isAnswer` type guard never validated individual citation elements -- replaced with `AnswerSchema.safeParse`, reusing the real schema instead of a weaker duplicate. (9) Duplicate-React-key risk if the LLM cites the same chunkId twice -- fixed. (10) A double-submit race (Enter-key native form submission bypasses a disabled submit button) could let a slower first response overwrite a newer second one -- fixed with an early-return guard. (11) `TOP_K` was redeclared as an independent literal in two places instead of reusing `libs/retrieval`'s exported default -- deduplicated. (12) No test pinned the exact Gemini generation model string -- added. Plus a bonus `retried` logging flag distinguishing a first-try success from a success-after-retry, previously indistinguishable in the request log.

  **Round 2 (5 smaller findings, requested explicitly as a second pass before considering the story done):** (1) `verifyCitations`'s `invalidChunkIds` wasn't deduplicated -- a repeated fabricated `chunkId` would appear twice in the retry-correction prompt. (2) `logRequest`'s error/log level check used a truthy check on `error` rather than an explicit `!== undefined` check, so an `Error` with an empty message would have logged at the wrong level. (3) The `retried` flag (from round 1's bonus) was untested for the zero-citations-then-retry-succeeds combination specifically. (4) `CONFIDENT_THRESHOLD`/`CLARIFY_THRESHOLD`'s exact calibrated values weren't pinned by any test -- only their relative ordering was. (5) No test proved `generateStructuredOutput` correctly propagates a rejected (not just a bad-content-resolved) `generateContent` call. All five fixed with regression tests.

  Ten additional lower-value findings across both rounds (pgvector HNSW approximate-search correctness under filters, no rate limiting on `POST /api/ask` until Epic 4, no server-side call timeouts/cancellation, no `AnswerSchema` refinement tying `confidence` to `insufficientEvidence`, two independently-memoized `AIProvider` instances rather than one shared singleton, no generation-config/temperature tuning, no question max-length guard, and others) were deferred rather than patched -- logged to `docs/implementation/deferred-work.md`. Re-verified after every round: full `nx run-many -t lint,test` and `npm run test:db-integration` pass throughout.

## Design Notes

**Threshold calibration (`CONFIDENT_THRESHOLD`/`CLARIFY_THRESHOLD`, `apps/api/src/app/ask/answer-thresholds.ts`):** These constants aren't given anywhere in the planning docs (`decisions.md`, "Confidence tiering": "no universal cosine-similarity cutoff exists"), so they were calibrated empirically rather than guessed. `apps/api/src/retrieval-eval-dataset-offtopic.json` was added as the companion off-topic/unanswerable control dataset (7 questions with zero relation to the Federalist Papers or 18th-century American political theory: cooking, bike repair, geography trivia, photosynthesis, gym routines, smartphone camera tech, cricket scoring rules). `apps/api/src/calibrate-thresholds.ts` (wired as `npm run calibrate:thresholds` / `nx run api:calibrate-thresholds`, mirroring `eval-retrieval`'s convention) embeds every question in both that dataset and the existing 8-question `retrieval-eval-dataset.json` for real against the live embedding model and the real, fully-ingested 85-paper/298-chunk corpus, and reports each question's top retrieved-chunk score plus a min/max/avg summary per group.

Actual run (2026-08-26, real Gemini embeddings, real corpus):
- On-topic top scores: min 0.7068, max 0.7788, avg 0.7336 (all 8 questions, e.g. "Why would a government still need internal checks and balances between its branches even if the people running it were as virtuous as angels?" -> 0.7425).
- Off-topic top scores: min 0.4756, max 0.5187, avg 0.4928 (all 7 questions, e.g. "What is the capital city of Australia?" -> 0.5187, the group's own max).

The two groups were cleanly separated with zero overlap -- a ~0.19 gap between the off-topic max (0.5187) and the on-topic min (0.7068). Chosen values:
- `CONFIDENT_THRESHOLD = 0.65` -- below every observed on-topic score (0.057 margin under the on-topic min, leaving room for a real question phrased less crisply than this curated eval set) while staying 0.131 clear of the off-topic max, so an off-topic question can't accidentally land confident.
- `CLARIFY_THRESHOLD = 0.55` -- above every observed off-topic score (0.031 margin over the off-topic max) without crowding `CONFIDENT_THRESHOLD`, leaving a genuine 0.10-wide clarify band (0.55-0.65) for questions that are marginally/partially on-topic -- a case neither eval dataset's deliberately clear-cut extremes exercises, by design.

**Confident tier requires at least one citation.** `verifyCitations` (`apps/api/src/app/ask/verify-citations.ts`) treats an empty `citations` array as invalid, not vacuously valid, triggering the same one-retry-then-fail-safe policy as a fabricated `chunkId`. This isn't spelled out verbatim in the frozen Boundaries text, but follows from "every citation... is verified" and the confident tier's whole premise being a *verified, grounded* answer: an answer with zero citations has nothing to verify, and treating that as "verification passed" would let an ungrounded answer through the exact safety net this story exists to build.

**Retrieval/embedding failure is not folded into the confident-tier retry-then-fail-safe policy.** The embedding call inside `retrieveRelevantChunks` runs before any tier is even decided (every tier needs it), so its failure (e.g. a missing `GEMINI_API_KEY`) is treated as a systemic configuration problem and left to propagate as a rejected promise -- Nest's default exception filter turns that into a 500, exactly matching `PapersService`'s identical `search/semantic` convention (Story 2.2) for the same I/O Edge-Case Matrix row. Only a confident-tier LLM-*generation* failure (schema-invalid output, or a citation-verification miss) enters the retry-then-fail-safe path and resolves to a 200 refuse-tier `Answer`.

**`POST /api/ask` returns HTTP 200, not Nest's `@Post()` default of 201** -- `@HttpCode(200)` is applied explicitly. Asking a question doesn't create a resource; 200 is the more accurate status for what the endpoint actually does.

## Verification

**Commands:**
- `curl -X POST http://localhost:3333/api/ask -d '{"question":"why would government still need checks and balances even if men were angels"}' -H 'Content-Type: application/json'` -- **actually run**: confident-tier answer citing Federalist No. 51, verified `chunkId`, `quotedPassage`, `relevanceExplanation`, `confidence: "high"`.
- `curl -X POST http://localhost:3333/api/ask -d '{"question":"what is the best pizza topping"}' -H 'Content-Type: application/json'` -- **actually run**: blanket insufficient-evidence response, `confidence: "low"`, `insufficientEvidence: true`, empty citations.
- `curl -X POST http://localhost:3333/api/ask -d '{"question":"tell me about government structure in general"}' -H 'Content-Type: application/json'` -- **actually run** (clarify tier, bonus check): best-guess paper (No. 84), bare citation with no `quotedPassage`, `confidence: "low"`, `insufficientEvidence: true`.
- `curl -X POST http://localhost:3333/api/ask -d '{"question":""}' -H 'Content-Type: application/json'` -- **actually run**: HTTP 400, no retrieval/LLM call.
- `nx run-many -t lint,test` -- exit 0 across all 7 projects, every round.
- `npm run test:db-integration` -- exit 0 (database 29 tests, retrieval 19 tests), every round.

## Suggested Review Order

**Entry point**

- `AskService.ask` -- reads the top retrieved chunk's score, decides the tier entirely in code, only calls the LLM for the confident tier.
  [`ask.service.ts:164`](../../apps/api/src/app/ask/ask.service.ts#L164)

**The safety net (citation verification + the review-caught headline gap)**

- `verifyCitations` -- deterministic `chunkId` set-membership check; an empty `citations` array is also treated as invalid.
  [`verify-citations.ts:26`](../../apps/api/src/app/ask/verify-citations.ts#L26)

- `finalizeCitations` -- the review-caught fix: re-derives `paperNumber`/`paperTitle` server-side from the matched retrieved chunk, never trusting the LLM's own echoed values for those two fields even after `chunkId` verification passes.
  [`ask.service.ts:103`](../../apps/api/src/app/ask/ask.service.ts#L103)

- `CONFIDENT_THRESHOLD`/`decideAnswerTier` -- the empirically-calibrated tier boundary (see Design Notes above for the actual observed on-topic/off-topic score spread).
  [`answer-thresholds.ts:26`](../../apps/api/src/app/ask/answer-thresholds.ts#L26)

**Generation (structured output, never trusted blindly)**

- `GeminiProvider.generateStructuredOutput` -- Gemini JSON-mode call, always re-validated with `schema.safeParse` regardless of the SDK's own schema hint.
  [`gemini.provider.ts:67`](../../libs/ai/src/lib/providers/gemini.provider.ts#L67)

- `AnswerSchema`/`CitationSchema` -- the only shape ever requested from the LLM (`answer`, `citations`); `confidence`/`insufficientEvidence` are added by the orchestrator afterward, never part of this schema.
  [`answer.ts:17`](../../libs/shared/src/lib/answer.ts#L17)

**Frontend**

- `AskQuestion`/`handleSubmit` -- self-contained question input; guards against a double-submit race (Enter-key native submission bypassing the disabled button).
  [`ask-question.tsx:57`](../../apps/web/src/components/ask-question.tsx#L57)

- `AnswerSection` -- renders answer, confidence, insufficient-evidence messaging, and a plain (not yet clickable) citation list.
  [`ask-question.tsx:161`](../../apps/web/src/components/ask-question.tsx#L161)

**Peripherals**

- `apps/api/src/calibrate-thresholds.ts` + `retrieval-eval-dataset-offtopic.json` -- the real, re-runnable tool that produced the threshold values above.
- `eslint.config.mjs`, `tsconfig.base.json`, `package.json` -- no changes needed this story (already updated by Story 2.2); `apps/api/project.json`/`webpack.calibrate-thresholds.config.js` add the new `calibrate-thresholds` Nx target.
