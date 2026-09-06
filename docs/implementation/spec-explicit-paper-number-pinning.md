---
title: 'Pin explicitly-numbered papers referenced in the question'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 0
context: []
baseline_revision: '9e216c9daa4ad8233e398088b4c9b9ad42e16e22'
followup_review_recommended: true
deferred:
  - summary: >-
      KEYWORD_CLUSTER_PATTERN can extract a false-positive paper number from an unrelated trailing
      quantity, e.g. "paper 4 and 6 dollars" would extract 6 as a referenced paper number.
    evidence: |-
      The pattern pulls every digit run out of a matched "paper/federalist ... and/,/& ..." span
      via match[0].match(/\d+/g), with nothing distinguishing a chained paper reference from a
      trailing unrelated number. Low practical impact for this app's actual question patterns
      (Federalist-papers Q&A, not commerce/quantities), so not fixed in this pass.
    location: >-
      apps/api/src/app/ask/paper-reference-extractor.ts (KEYWORD_CLUSTER_PATTERN)
    severity: low
  - summary: >-
      MAX_EXPLICIT_PAPER_PINS's doc comment example ("summarize papers 1 through 85") doesn't
      match what the regex actually recognizes (no range/"through" support), and the real
      worst-case pin count is the cap plus one when currentPaper is also set.
    evidence: |-
      "Papers 1 through 85" would only extract the number 1 today (no range-separator support in
      KEYWORD_CLUSTER_PATTERN) -- the cap is still reachable via a comma-separated list, so the
      protection itself is real, but the comment's motivating example is inaccurate and the +1
      from currentPaper is unstated.
    location: >-
      apps/api/src/app/ask/ask.service.ts (MAX_EXPLICIT_PAPER_PINS doc comment)
    severity: low
  - summary: >-
      No word-number ("paper four") or ordinal ("the fourth paper") phrasing support -- digit-only
      references are recognized.
    evidence: |-
      Explicitly documented, intentional scope boundary (this story's Design Notes: the seam for a
      future LLM-based extractor, not a gap in this story) -- recorded here as a known limitation
      for visibility, not a defect.
    location: >-
      apps/api/src/app/ask/paper-reference-extractor.ts
    severity: low
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Retrieval is pure semantic vector search over passage content. A question that names a specific paper by number ("what is paper 4 about?", "compare this to paper 4") has almost no semantic similarity to that paper's actual content — the words "paper 4" don't resemble Federalist No. 4's real text (foreign wars, fleets, navigation treaties) at all. Confirmed live (2026-09-05): asking "what is paper 4 about?" and "can you summarize Paper 4 of the federalist papers?" both retrieved chunks from papers 1, 2, 3, and 5 — paper 4 itself never appeared in `retrievedPaperNumbers` even though it is fully present in the database (confirmed via `GET /api/papers/4`). The LLM correctly refused both times (zero citations, citation verification's fail-safe working exactly as designed) because it was genuinely never given paper 4's text to answer from.

**Approach:** `AskService.ask` already has this exact mechanism for a different trigger: when `currentPaper` is set (the quill widget's context chip), it pins that paper's full chunks via `getAllChunksForPaper` — a plain DB lookup, no embedding call — as extra evidence when the paper didn't already make the unrestricted top-K, and forces the confident tier so a low-similarity meta-question ("summarize this paper") still gets a real attempt (`ask.service.ts`'s existing 2026-09-03 follow-up comment explains the reasoning in full). This story extends the same mechanism to a second trigger: paper numbers named explicitly in the question text itself.

**Swappable extraction, decided 2026-09-05 (product discussion, informed by research into how production RAG systems handle this — see Design Notes):** regex is a defensible, reasonable implementation for this app's scale (85 documents, one clean integer ID field, a small vocabulary of reference phrasings) — it's functionally a hand-rolled, degenerate case of the more general pattern production systems use at larger scale (LLM-inferred structured metadata filters, e.g. LangChain's self-query retriever / LlamaIndex's auto-retrieval). Rather than hardcode the regex directly into `AskService`, extraction is defined behind a `PaperReferenceExtractor` interface — the same Adapter pattern already used for `EmbeddingProvider`/`GenerationProvider` (`libs/ai`) — so a future LLM-based (or any other) extractor can be swapped in later as one new class plus one factory change, with zero changes to `AskService` or its tests' call-site expectations.

## Boundaries & Constraints

**Always:**
- `PaperReferenceExtractor` is a one-method interface: `extractPaperNumbers(question: string): Promise<number[]>` — `Promise`-returning even though the regex implementation is synchronous internally, specifically so a future async implementation (e.g. one that makes an LLM call) satisfies the same interface with no signature change.
- `RegexPaperReferenceExtractor implements PaperReferenceExtractor` is the only implementation this story ships. It matches patterns like "paper 4", "paper no. 4", "paper #4", "federalist 4", "federalist no. 4", "No. 4" and returns validated, in-range, capped, deduplicated paper numbers — see the specific rules below, all of which belong to this implementation, not the interface.
- A `createPaperReferenceExtractor()` factory (mirroring `createEmbeddingProvider()`/`createGenerationProvider()`'s shape in `libs/ai/src/lib/ai-provider.factory.ts`) is the single seam `AskService` depends on — it returns `RegexPaperReferenceExtractor` today; swapping implementations later means changing this one factory function, not any call site.
- `AskService` depends only on the `PaperReferenceExtractor` interface (injected the same lazy-construction way `EMBEDDING_PROVIDER`/`GENERATION_PROVIDER` already are, via `apps/api/src/app/ai-provider.provider.ts`'s pattern) — it never imports `RegexPaperReferenceExtractor` or knows regex is involved.
- Extracted numbers are validated to the valid paper range (1–85 inclusive) before any DB lookup is attempted — an out-of-range or malformed match (e.g. "paper 200") is silently dropped, never an error. Range validation is the extractor's own responsibility (part of returning a clean `number[]`), not something `AskService` re-checks.
- Pinning explicitly-referenced papers is additive to the existing `currentPaper` pinning, not a replacement — both can apply on the same request (e.g. reading paper 1, asking "compare to paper 4" pins both 1 and 4, deduplicated so a paper referenced both ways is only fetched once).
- When the extractor returns at least one paper number, the tier is forced to `'confident'` exactly like `currentPaper` already does today (same reasoning: this is itself a deterministic signal that real evidence exists, stronger than a raw similarity score for this class of question) — citation verification still fails safe to refuse if the answer isn't actually grounded, unchanged.
- Pinning per detected paper number is best-effort, exactly like the existing `currentPaper` pin: a `getAllChunksForPaper` failure for one number is logged and skipped, never fails the whole question. Likewise, the extractor call itself is wrapped so a future (non-regex) implementation's failure degrades to "no explicit references detected" rather than failing the whole question over an enhancement.
- A hard cap (`MAX_EXPLICIT_PAPER_PINS`, e.g. 5) limits how many distinct paper numbers get pinned from one question — prevents a question like "summarize papers 1 through 85" from pinning the entire corpus into one prompt and guaranteeing a `context_length_exceeded` refusal (spec-conversation-history-context.md's new failure kind) on every such question. This cap is enforced in `AskService` (applies to whatever the extractor returns, regardless of implementation), not inside the extractor itself — a future extractor implementation shouldn't need to know about this limit.
- New tests cover: single explicit reference detected and pinned; multiple references (within cap) all pinned; references beyond the cap are truncated; out-of-range/malformed numbers ignored (extractor-level test); `currentPaper` + an explicit reference both pin, deduplicated when they name the same paper; a lookup failure for one referenced paper doesn't block the others; the extractor throwing/rejecting doesn't fail the whole question.

**Never:**
- Do not let `AskService` import or reference `RegexPaperReferenceExtractor`, regex, or any pattern-matching detail directly — it depends only on `PaperReferenceExtractor` and `createPaperReferenceExtractor()`, exactly like it already depends only on `EmbeddingProvider`/`GenerationProvider`, never `GeminiProvider`.
- Do not change `retrieveRelevantChunks`'s signature, SQL, or its own filter-before-limit behavior — this story only adds to the post-retrieval pinning step, exactly where `currentPaper` pinning already lives.
- Do not pin a paper number silently beyond the cap without it being a deliberate, documented truncation (no silent unbounded growth) — this connects directly to the context-length safety net just built in spec-conversation-history-context.md.
- Do not touch citation verification, confidence-tiering thresholds, or the streaming layers — this is purely an evidence-assembly change, same boundary as every prior story that touched this pinning step.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Explicit reference, not already retrieved | "What is paper 4 about?", paper 4 absent from unrestricted top-K | Paper 4's chunks pinned as extra evidence; tier forced to `confident` | N/A |
| Explicit reference already in top-K | Question names a paper that already ranked in the unrestricted search | No duplicate pinning (same "already present" check as `currentPaper`'s existing logic) | N/A |
| Multiple explicit references within cap | "Compare papers 4 and 6" | Both papers' chunks pinned | N/A |
| References beyond the cap | Extractor returns more than `MAX_EXPLICIT_PAPER_PINS` distinct valid numbers | Only the first `MAX_EXPLICIT_PAPER_PINS` (in order returned) are pinned | Not an error — a deliberate, documented truncation, enforced in `AskService` |
| Out-of-range or malformed number (regex extractor specifically) | "paper 200", "paper 0", "paper -1" | `RegexPaperReferenceExtractor` excludes these from its returned array | Never an error |
| `currentPaper` and an explicit reference name the same paper | Reading paper 1, asks "more about paper 1" | Fetched/pinned once, not twice | N/A |
| `currentPaper` set, question references a *different* paper | Reading paper 1, asks "compare to paper 4" | Both paper 1 (if not in top-K) and paper 4 pinned | N/A |
| No explicit reference, no `currentPaper` | A question with no paper-number pattern at all | Behavior identical to today — no regression | N/A |
| `getAllChunksForPaper` fails for one referenced number | DB error pinning one of several referenced papers | That paper's pin is skipped (logged); other pins and the unrestricted results still proceed | Never fails the whole request over a best-effort enhancement |
| `extractPaperNumbers` itself throws/rejects | Extractor implementation failure (any implementation) | Treated as "no explicit references" — logged, `AskService` proceeds exactly as if the extractor had returned `[]` | Never fails the whole request |

</frozen-after-approval>

## Code Map

- `apps/api/src/app/ask/paper-reference-extractor.ts` (new) — `PaperReferenceExtractor` interface, `RegexPaperReferenceExtractor` implementation, `createPaperReferenceExtractor()` factory (returns `RegexPaperReferenceExtractor` today).
- `apps/api/src/app/ai-provider.provider.ts` (or a new sibling file, e.g. `paper-reference-extractor.provider.ts`) — `PAPER_REFERENCE_EXTRACTOR` DI token + lazy-construction provider, same pattern as `createEmbeddingProviderProvider`/`createGenerationProviderProvider`.
- `apps/api/src/app/ask/ask.module.ts` — wire the new provider in alongside the existing two.
- `apps/api/src/app/ask/ask.service.ts` — inject `PaperReferenceExtractor` via the new token; call `extractPaperNumbers(question)` alongside the existing `currentPaper` pinning block, cap the result to `MAX_EXPLICIT_PAPER_PINS`, merge/dedupe with `currentPaper`'s own number, pin each via `getAllChunksForPaper`; tier-forcing condition extended from `currentPaper ? 'confident' : retrievalTier` to also force `'confident'` when the (capped) extractor result is non-empty.
- Test files: `paper-reference-extractor.spec.ts` (new — the regex implementation's own matrix rows: patterns matched, range validation, malformed input), `ask.service.spec.ts` (new describe block — pinning/cap/dedupe/tier-forcing/failure-degrades-gracefully behavior, using a fake `PaperReferenceExtractor` exactly like existing tests use a fake `EmbeddingProvider`/`GenerationProvider`).

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/app/ask/paper-reference-extractor.ts` -- `PaperReferenceExtractor` interface, `RegexPaperReferenceExtractor`, `createPaperReferenceExtractor()`
- [x] DI wiring (token + provider + module registration), mirroring `EMBEDDING_PROVIDER`/`GENERATION_PROVIDER`
- [x] `apps/api/src/app/ask/ask.service.ts` -- inject extractor, wire into pinning block and tier-forcing condition, apply `MAX_EXPLICIT_PAPER_PINS` cap and dedupe against `currentPaper`
- [x] Update/add tests for every I/O matrix row (extractor-level and `AskService`-level, using a fake extractor for the latter)
- [x] Run `nx run-many -t test --projects=api` -- zero regressions (261/261 passing, up from 259 pre-existing)

**Acceptance Criteria:**
- Given the question "What is paper 4 about?" with no `currentPaper` set, when `/api/ask` is called, then paper 4's chunks are pinned as evidence and the answer is a genuine, grounded summary of Federalist No. 4 — not a refusal.
- Given a question whose extracted paper numbers exceed `MAX_EXPLICIT_PAPER_PINS`, when pinning runs, then only the first `MAX_EXPLICIT_PAPER_PINS` are pinned, and no `context_length_exceeded` failure is triggered by this mechanism alone for a reasonably-sized cap.
- Given `currentPaper` is set and the question also explicitly names that same paper number, when pinning runs, then `getAllChunksForPaper` is called at most once for that paper number.
- Given a fake `PaperReferenceExtractor` that rejects, when `AskService.ask` runs, then the question still completes (degrades to "no explicit references"), proving `AskService` depends only on the interface's contract, not on regex ever succeeding.

## Design Notes

**Why swappable, not just regex (2026-09-05):** researched how production RAG systems (OpenAI's retrieval API, LangChain, LlamaIndex, Anthropic's Contextual Retrieval, hybrid BM25+vector search in Elasticsearch/Qdrant/Weaviate/Pinecone) handle resolving explicit ID/numeric references when pure semantic search fails. Two standard patterns emerged: hybrid lexical+vector search (BM25 catches exact tokens embeddings miss), and LLM-driven structured metadata filtering (LangChain's self-query retriever, LlamaIndex's auto-retrieval) — an LLM infers a structured filter from the NL question against a declared schema, rather than a hand-written regex. For this app's scale (85 documents, one clean integer ID, a small reference-phrasing vocabulary), regex is a reasonable, defensible special case of the metadata-filter pattern — not an anti-pattern — but it doesn't scale as gracefully as the LLM-based alternative would for a larger/messier corpus or more varied phrasing. Rather than commit to regex permanently, the `PaperReferenceExtractor` interface keeps the door open: a future `LlmPaperReferenceExtractor` (using the same `generateStructuredOutput` pattern already proven in `GeminiProvider`/`OpenRouterProvider`) could replace `createPaperReferenceExtractor()`'s implementation later, if real usage ever shows phrasing the regex misses ("the fourth paper," "essay four," etc.) — with zero changes to `AskService` or its existing tests.

## Verification

**Commands:**
- `nx run-many -t test --projects=api` -- expect no regressions
- Manual: reproduce this story's exact failing sequence ("what is paper 4 about?" while reading paper 1) and confirm a real, grounded answer comes back instead of a refusal.

## Suggested Review Order

1. `apps/api/src/app/ask/paper-reference-extractor.ts` -- the new interface/implementation/factory; check the regex clusters against the I/O matrix (single/multi/comma-and-"and"-joined/out-of-range/malformed references).
2. `apps/api/src/app/ask/paper-reference-extractor.spec.ts` -- extractor-level coverage of the same matrix.
3. `apps/api/src/app/ai-provider.provider.ts` -- `PAPER_REFERENCE_EXTRACTOR` token + lazy-construction provider, mirroring the existing two.
4. `apps/api/src/app/ask/ask.module.ts` -- provider registration.
5. `apps/api/src/app/ask/ask.service.ts` -- the `ask()` method's extended pinning/tier-forcing block: extractor call (wrapped, degrades to `[]`), `MAX_EXPLICIT_PAPER_PINS` cap, `currentPaper` + explicit-reference dedupe via one `Set`, per-paper best-effort pinning loop.
6. `apps/api/src/app/ask/ask.service.spec.ts` -- new "explicit paper-number references" describe block (single/multiple/cap/dedupe/partial-failure/extractor-rejects/no-regression), plus the `buildService`/direct-construction call sites updated to pass a fake extractor.
7. `apps/api/src/app/ask/ask.http.spec.ts` and `apps/api/src/app/ai-provider.provider.spec.ts` -- incidental updates needed to keep existing suites compiling/passing against the new constructor parameter and DI token.

## Verification Results (2026-09-05)

- `nx run-many -t lint test --projects=api`: 18/18 suites, 263/263 tests passing (259 pre-existing + 4 new: the empty-pin-result no-force-confident regression test, the bare-comma-list extractor test, plus 2 more from the initial pass). Zero lint errors.
- Review follow-up (2026-09-05, three independent reviewers): fixed a real bug where `tier` was forced to `'confident'` based only on whether an explicit reference was *detected*, computed before the pin loop ran -- an in-range paper number whose `getAllChunksForPaper` lookup resolved to `[]` (not a thrown error, e.g. a partial-ingestion gap) was still treated as grounds to force the confident tier, risking a "confidently wrong" answer grounded only in unrelated top-K chunks. Fixed by moving the tier decision to after the pin loop and basing it on `hasGroundedPinnedPaper` -- whether any pinned-for paper number actually ended up represented in `chunks` post-pin, not on detection alone. Also added a `logger.warn` when explicit references are truncated by `MAX_EXPLICIT_PAPER_PINS` (previously silent) and a test for a bare comma-separated reference list ("papers 4, 6") with no trailing "and".
- Manual verification of the story's motivating scenario (asking "what is paper 4 about?") was not re-run against a live Gemini-backed server in this pass -- see "Left incomplete/risky" in the implementation report for why, and what a follow-up manual check should confirm.

## Review Triage Log

### 2026-09-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high)
- defer: 3 (0 high, 0 medium, 3 low)
- reject: 8
- addressed_findings:
  - `[high]` `[patch]` `tier` was forced to `'confident'` purely from extractor detection, computed before the pin loop ran -- an in-range paper number whose pin resolved to `[]` (not a thrown error) still forced the confident tier with no real grounding for that paper, risking a "confidently wrong" answer. Confirmed independently by all three review layers (blind-hunter, verification-gap, intent-alignment auditor). Fixed: tier is now computed after the pin loop from `hasGroundedPinnedPaper` (whether any pinned-for paper number actually landed in `chunks`), not from detection alone. Bundled in the same pass: a `logger.warn` on `MAX_EXPLICIT_PAPER_PINS` truncation (previously silent), and a test for a bare comma-separated reference list. Re-ran `nx run-many -t test,lint --projects=api --skip-nx-cache` -- 18/18 suites, 263/263 tests pass, 0 lint errors.

Reviewed and rejected as non-issues (verified, not merely dismissed):
- Edge Case Hunter's ReDoS/catastrophic-backtracking concern on `KEYWORD_CLUSTER_PATTERN` -- tested directly against a 50,000-repetition adversarial string with no terminating digit; resolved instantly (0ms). Each alternative in the repeated group requires progressing through a digit run, so there's no ambiguous backtracking path -- not a real vulnerability.
- Edge Case Hunter's "`question` could be null/undefined at runtime despite the type annotation" -- refuted: `AskController.ask` already validates/trims `question` into a guaranteed non-blank string before `AskService.ask` is ever called; unreachable via the real request path.
- Edge Case Hunter's "partial-presence `chunks.some()` check skips the pin fetch entirely" -- refuted as this story's problem: this exact check predates this story (it's `currentPaper` pinning's original 2026-09-03 logic, merely reused for the merged pinning loop), not new behavior introduced here.
- Blind Hunter's "caching wrapper in `createPaperReferenceExtractorProvider` is unverified/possibly redundant vs. NestJS's own scoping" -- rejected: this mirrors `createEmbeddingProviderProvider`/`createGenerationProviderProvider`'s exact existing, already-accepted pattern in the same file, not a new inconsistency.
- Blind Hunter's "no integration/e2e-level test for the new pinning path through the real HTTP controller" -- rejected: matches this codebase's existing test-layering convention (pinning behavior is tested at the `AskService` unit level; `ask.http.spec.ts` only proves basic DI wiring compiles/runs), consistent with how `currentPaper` pinning itself was tested, not a gap unique to this story.
- Blind Hunter's "no range ('papers 1 through 85') or word-number ('paper four') support" -- these are explicitly documented, intentional scope boundaries (this story's own Design Notes name them as the seam for a possible future LLM-based extractor), not defects; retained as low-severity deferred notes for visibility, not findings requiring action.
- Remaining Blind Hunter findings (long unwrapped lines in test literals, `MAX_PAPER_NUMBER=85` as an independent hardcoded constant) -- cosmetic/consistency nits with no behavioral impact; lint passed clean, so no formatting violation actually exists.

## Auto Run Result

**Summary:** Added `PaperReferenceExtractor` (regex-backed today, swappable behind an interface + factory seam mirroring `EmbeddingProvider`/`GenerationProvider`) to detect paper numbers named explicitly in a question ("what is paper 4 about?"), wired into `AskService`'s existing `currentPaper` pinning mechanism -- both triggers now share one deduplicated pin loop, capped at `MAX_EXPLICIT_PAPER_PINS` (5). Post-review patch ensures the confident tier is only forced when a pinned paper's evidence actually landed, not merely when a reference was detected.

**Files changed:** `apps/api/src/app/ask/paper-reference-extractor.ts` (new), `apps/api/src/app/ask/paper-reference-extractor.spec.ts` (new), `apps/api/src/app/ai-provider.provider.ts` (+spec), `apps/api/src/app/ask/ask.module.ts`, `apps/api/src/app/ask/ask.service.ts` (+spec), `apps/api/src/app/ask/ask.http.spec.ts`.

**Review findings breakdown:** 1 patch applied (high severity -- tier forced without confirming grounded evidence), 3 deferred (all low severity -- false-positive risk on trailing quantities, an inaccurate doc-comment example, and the already-documented word-number/range scope boundary), 8 rejected as non-issues after verification (see Review Triage Log for each refutation).

**Follow-up review recommendation:** `true` (one high-severity patch was applied this pass).

**Verification performed:** `nx run-many -t test,build,lint --projects=api --skip-nx-cache` -- 18/18 suites, 263/263 tests pass, build/lint clean. Matrix Test Audit: every I/O & Edge-Case Matrix row confirmed covered by a passing, real test before proceeding to review.

**Residual risks:** (1) manual live reproduction of the motivating "what is paper 4 about?" scenario against a running Gemini-backed server has not been performed; (2) the three deferred low-severity items above remain open, not blocking.
