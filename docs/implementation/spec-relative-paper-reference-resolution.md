---
title: 'Resolve relative/ordinal paper references ("the paper prior to 5")'
type: 'feature'
created: '2026-09-06'
status: 'ready-for-dev'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `PaperReferenceExtractor` (spec-explicit-paper-number-pinning.md) resolves explicit paper numbers named in a question ("paper 4," "No. 4") but has no concept of *relative* references. Confirmed live (2026-09-05): asking "what was discussed in the paper prior to paper 5?" pinned only paper 5 (the literal number matched in the text) and never resolved "prior to" -- the actual target, paper 4, was never retrieved or pinned. The model answered fluently using papers 1, 3, and 5 instead, producing a confident-sounding but wrong-paper answer. This is a distinct gap from the already-deferred "word-number"/"paper four" phrasing gap: it requires arithmetic on a number ("prior to 5" → 4, "two after 10" → 12), not just recognizing a different way of writing the same number.

**Why this isn't a prompt-wording fix:** researched (2026-09-05/06) whether persona/role-based system-prompt framing ("you are helping history researchers...") could resolve this. Persona prompting is a well-established technique (Anthropic's own docs recommend it) but the literature (Zheng et al. 2024, arXiv:2311.10054; contested further in later work) finds it shifts tone/style/verbosity, not factual accuracy or reasoning correctness -- and more fundamentally, no system-prompt wording can make the model cite content it was never given. Paper 4's chunks were never in the evidence block for that request regardless of instructions; this is an evidence-assembly gap, not a framing gap. The fix has to happen at extraction/retrieval time, before the prompt is built.

**Approach:** Extend paper-reference resolution to also recognize relative/ordinal phrasing ("the paper prior to N," "before paper N," "the paper after N," "two papers after N") and resolve it to a concrete number before pinning -- reusing the exact same `PaperReferenceExtractor` interface and pinning mechanism already built; only the extraction step needs new capability. Given how open-ended relative phrasing is in natural language (unlike explicit numbers, which have a small, enumerable vocabulary), this is the case the swappable-extractor design was built for: a regex can cover the common phrasings, but an LLM-based extractor would handle arbitrary rephrasing without new hand-written rules per variant. Which to build is an open decision -- see Design Notes.

## Boundaries & Constraints

**Always:**
- Whatever implementation is chosen still satisfies `PaperReferenceExtractor`'s existing interface (`extractPaperNumbers(question: string): Promise<number[]>`) — no interface change, no `AskService` changes beyond what spec-explicit-paper-number-pinning.md already built.
- Resolved relative numbers still go through the same range validation (1–85), cap (`MAX_EXPLICIT_PAPER_PINS`), and dedup-with-`currentPaper` logic already in `AskService` — nothing about the pinning/tier-forcing mechanism changes, only what numbers the extractor can produce.
- A relative reference that resolves out of range (e.g. "the paper before paper 1," "the paper after paper 85") is dropped silently, matching the existing out-of-range boundary — never an error.
- New tests cover at minimum: "prior to paper N" / "before paper N" (→ N-1), "after paper N" / "following paper N" (→ N+1), an out-of-range resolution being dropped, and a question combining an explicit and a relative reference (e.g. "compare paper 5 to the one before it").

**Never:**
- Do not change `AskService`'s pinning/tier-forcing/capping logic — this story is scoped entirely to what `PaperReferenceExtractor` (or its replacement) can extract, not how extracted numbers are used downstream.
- Do not attempt to resolve genuinely ambiguous relative language ("an earlier paper," "one of the papers before this") to a specific number — only resolve unambiguous, single-step relative references. Ambiguous phrasing should resolve to no reference (degrade to normal retrieval), never a guess.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| "prior to"/"before" | "what was discussed in the paper prior to paper 5?" | Resolves to `[4]`, pinned as evidence | N/A |
| "after"/"following" | "what comes after paper 10?" | Resolves to `[11]` | N/A |
| Relative reference resolves out of range | "the paper before paper 1" | Dropped silently (no lookup attempted) | Never an error |
| Explicit + relative combined | "compare paper 5 to the one before it" | Resolves to `[5, 4]` | N/A |
| Ambiguous relative phrasing | "an earlier paper" | No number extracted — behaves as if no reference were present | Never a guess |

</frozen-after-approval>

## Code Map

_To be filled in at planning/implementation time, once the regex-vs-LLM-extractor decision (see Design Notes) is made._

## Tasks & Acceptance

**Execution:**
- [ ] Decide regex extension vs. LLM-based `PaperReferenceExtractor` implementation (see Design Notes)
- [ ] Implement chosen approach
- [ ] Tests for every I/O matrix row
- [ ] Run `nx run-many -t test --projects=api` -- zero regressions

**Acceptance Criteria:**
- Given "what was discussed in the paper prior to paper 5?", when `/api/ask` is called, then paper 4's chunks are pinned and the answer is grounded in paper 4 — not papers 1/3/5.

## Design Notes

**Open decision, not resolved by this spec:** regex extension (a handful of new patterns for "prior to/before/after/following N" with N±1 arithmetic — cheap, fast, no added LLM call, but only covers phrasings explicitly written for) vs. an LLM-based `PaperReferenceExtractor` (one extra `generateStructuredOutput` call per question using the same pattern already proven in `GeminiProvider`/`OpenRouterProvider` — handles arbitrary rephrasing, at the cost of added latency/cost on every question, same tradeoff discussed and deferred when this whole extractor design was first scoped). Given this app's low question volume and how narrow the relative-reference vocabulary actually is in practice ("prior to," "before," "after," "following" cover most natural phrasings), a regex extension is probably still the pragmatic choice — but this is a judgment call for whoever picks this up, not a decision made here.

**Status note (2026-09-06):** this is a real, confirmed gap, not hypothetical — but low-severity relative to the explicit-reference fix already shipped (relative references are a narrower slice of real usage). No urgency implied by this spec existing; pick up whenever it's worth the time.

## Verification

**Commands:**
- `nx run-many -t test --projects=api` -- expect no regressions
- Manual: reproduce "what was discussed in the paper prior to paper 5?" and confirm the answer is grounded in paper 4.

## Suggested Review Order

Not yet implemented -- populate once execution completes.
