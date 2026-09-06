---
title: 'Add paragraph-level locators to citations (e.g. "Federalist No. 81, ¶16")'
type: 'feature'
created: '2026-09-06'
status: 'ready-for-dev'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Citations currently identify a paper (`paperNumber`/`paperTitle`) and carry a verbatim `quotedPassage`, but nothing locates *where within the paper* that passage falls. Paragraph-level locators ("Federalist No. 81, ¶16") are a legitimate, precedented scholarly convention (used because paragraph numbering is stable across print editions where page numbers aren't — Gregory Maggs' BU Law Review guide to using The Federalist as evidence of original meaning cites this way) that would make citations feel more authoritative and let a reader locate a passage without needing `quotedPassage`'s full text.

**Why this doesn't require re-embedding or a DB wipe:** `libs/documents/src/lib/chunker.ts`'s `chunkText` already splits strictly on paragraph boundaries (`text.split(/\n\s*\n/)`) and never splits mid-paragraph except a rare oversized-paragraph fallback — every stored chunk's content is literally `paragraphs.join('\n\n')`. Paragraph identity is already fully preserved *inside* existing chunk content; this story only needs to record *which* paragraph range each already-stored chunk corresponds to. Since chunk boundaries/content and their embeddings are completely unchanged, this is a pure offline text-matching backfill against already-stored data (`document_chunks.content` + `federalist_papers.full_text`), not a re-ingestion.

**Approach:** Add nullable `paragraph_start`/`paragraph_end` columns to `document_chunks` (migration). Write a one-time backfill script: for each paper, re-split its stored `full_text` the same way `chunkText` does, then match each of that paper's already-stored chunks' content against the resulting paragraph list (in order) to compute which paragraph range it falls in. Thread the resulting locator through `RetrievedChunk`/`Citation` so the frontend can render it (e.g. alongside or instead of the `quotedPassage` snippet added in spec-citation-display-differentiation.md).

## Boundaries & Constraints

**Always:**
- No re-embedding, no re-ingestion, no DB wipe — this is an additive migration + an offline backfill script operating only on already-stored `content`/`full_text` columns.
- The backfill must be idempotent and safely re-runnable (in case it's interrupted or a paper's data changes) — same convention as the original ingestion pipeline's idempotency guarantee.
- Paragraph matching must be exact/deterministic (chunk content must literally match a contiguous paragraph range from the re-split full text) — if a chunk's content can't be matched confidently (e.g. the oversized-paragraph hard-split fallback path, which doesn't preserve whole-paragraph boundaries), leave its locator columns `null` rather than guessing. A citation with no locator falls back to today's behavior (no paragraph info shown), never a wrong one.
- `Citation`'s schema gains optional fields (e.g. `paragraphStart`/`paragraphEnd`), consistent with `quotedPassage`/`relevanceExplanation`'s existing optional-field pattern — never required, since older data or an unmatched chunk won't have it.
- New tests cover: a normal chunk resolves to the correct paragraph range; the oversized-paragraph fallback case (or any unmatchable chunk) resolves to `null`/absent rather than a wrong guess; the backfill is safely re-runnable without duplicating or corrupting data.

**Never:**
- Do not change `chunkText`, the ingestion pipeline, or any embedding call — this is entirely additive metadata about existing chunks.
- Do not fabricate a paragraph locator when exact matching fails — absent is always correct; wrong is never acceptable for a scholarly-style citation claim.
- Do not make `paragraphStart`/`paragraphEnd` required in the `Citation` schema — must degrade gracefully wherever they're absent.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Normal chunk (whole-paragraph boundaries) | A chunk whose content is one or more whole paragraphs from the paper's full text | Backfill computes and stores the correct paragraph range | N/A |
| Oversized-paragraph fallback chunk | A chunk produced by `splitOversizedParagraph` (a paragraph too large, hard-split by word count) | Locator columns left `null` — no confident whole-paragraph match exists | Never a guessed/wrong range |
| Backfill re-run | Backfill script run a second time over already-backfilled data | Idempotent — same result, no duplication/corruption | N/A |
| Citation with a locator | Frontend receives `paragraphStart`/`paragraphEnd` | Rendered as part of the citation (exact rendering per spec-citation-display-differentiation.md's UI, or a follow-up to it) | N/A |
| Citation without a locator (older data, or an unmatched chunk) | `paragraphStart`/`paragraphEnd` absent | Citation renders exactly as it does without this story — no broken/blank locator shown | N/A |

</frozen-after-approval>

## Code Map

_To be filled in at planning/implementation time._ Expected touch points: `libs/database` (migration), a new backfill script (mirroring `apps/api/src/ingest.ts`'s standalone-script conventions), `libs/retrieval` (`RetrievedChunk` gains the locator fields), `libs/shared/src/lib/answer.ts` (`Citation` gains optional `paragraphStart`/`paragraphEnd`), `apps/api/src/app/ask/ask.service.ts`/`answer-prompt.ts` (threading, if the LLM should be told the locator so it can be asked to preserve it — open question, not yet decided), frontend citation rendering.

## Tasks & Acceptance

**Execution:**
- [ ] Migration: add nullable `paragraph_start`/`paragraph_end` to `document_chunks`
- [ ] Backfill script: re-split stored `full_text`, match against stored chunk `content`, populate the new columns (idempotent)
- [ ] `Citation` schema: add optional `paragraphStart`/`paragraphEnd`
- [ ] Thread the locator from retrieval through to the citation the frontend receives
- [ ] Frontend: render the locator where present
- [ ] Tests for every I/O matrix row
- [ ] Run the full test suite -- zero regressions

**Acceptance Criteria:**
- Given a normal (whole-paragraph) chunk, when the backfill runs, then its citation includes the correct paragraph range.
- Given an oversized-paragraph-fallback chunk, when the backfill runs, then its locator is absent, never a wrong guess.
- Given the backfill is run twice, then the result is identical both times (idempotent).

## Design Notes

**Status note (2026-09-06):** scoped as a follow-up to spec-citation-display-differentiation.md, which solves the immediate "citations look duplicated" problem without needing this. This story is about citation *quality/authority* (a more scholarly-feeling locator), not a blocking UX bug — pick up whenever it's worth the backfill-script effort, no urgency implied by this spec's existence.

**Open question, not resolved by this spec:** should the LLM be told the paragraph locator (so it could reference it directly in prose, e.g. "as argued in ¶16"), or should the locator be purely a citation-metadata display concern the frontend renders without the model ever seeing it? The latter is simpler and lower-risk (no prompt/model-behavior change); leaning that direction, but not decided here.

## Verification

**Commands:**
- Run the backfill against a copy of real ingested data and manually spot-check a handful of papers' computed paragraph ranges against the actual source text.
- Full existing test suite -- expect no regressions.

## Suggested Review Order

Not yet implemented -- populate once execution completes.
