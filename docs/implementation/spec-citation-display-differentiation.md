---
title: 'Differentiate multiple citations from the same paper in the citation list'
type: 'feature'
created: '2026-09-06'
status: 'done'
review_loop_iteration: 0
context: []
baseline_revision: 'f344c219b001111d38885135c3f584e2b5f36f30'
followup_review_recommended: false
deferred:
  - summary: >-
      truncateCitationSnippet truncates by raw character count, which can cut mid-word (no word-
      boundary awareness).
    evidence: |-
      Matches the spec's own guidance ("roughly 80-120 characters is a reasonable starting point
      ... exact number is an implementation detail, not a frozen requirement") -- a cosmetic
      polish item, not a defect. Federalist Papers source text is plain ASCII, so no unicode/
      surrogate-pair splitting risk in practice either.
    location: >-
      apps/web/src/lib/citation-snippet.ts
    severity: low
  - summary: >-
      The citation snippet has no blockquote/cite semantic markup or aria-label distinguishing it
      as a quotation for assistive tech -- it's reachable as plain text (satisfying the frozen
      Boundaries' literal "reachable by assistive tech" requirement) but not marked up as a quote.
    evidence: |-
      A pure enhancement, not a defect against this story's frozen intent, which only required
      the text be reachable, not semantically marked as a quotation.
    location: >-
      apps/web/src/components/quill/quill-panel.tsx (citation snippet <p>)
    severity: low
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When an answer cites multiple passages from the same paper (a common, correct outcome — different chunks genuinely supporting different claims), the citation list shows the identical line "No. 4 — {title}" repeated once per citation, with nothing distinguishing them without clicking each one individually. Confirmed live (2026-09-05): a real answer about Federalist No. 4 rendered "No. 4 — The Same Subject Continued..." four times in a row — functionally four distinct grounded quotes, but visually reads as a duplication bug to anyone who hasn't inspected the underlying data (`quill-panel.tsx:436-455`).

**Research (2026-09-06):** two things informed the approach:
1. **Federalist Papers citation convention** — "Federalist No. N" is already the standard, universally-recognized shorthand across MLA/APA/Chicago and legal/historical scholarship (comparable to Bible chapter:verse) — no change needed there. Paragraph-level locators ("Federalist No. 81, ¶16") are legitimate, precedented scholarly practice (used because paragraph numbering is stable across print editions where page numbers aren't) — but this app's chunks are word-count-based (`INGEST_CHUNK_TARGET_WORDS`), not paragraph-indexed, so a paragraph locator isn't backed by real data without new ingestion work.
2. **How production RAG/answer products handle this** — Anthropic's Citations API, Perplexity, and NotebookLM all keep multiple citations from the same source as *separate* markers/chips rather than grouping/collapsing them, and several (NotebookLM's "expanded" mode in particular) show the actual quoted text per citation, not just the source name, specifically so same-source citations are visually distinguishable without a click.

**Approach:** No new data needed — `Citation.quotedPassage` (`libs/shared/src/lib/answer.ts`) already carries a short, verbatim quote per citation, already populated by the confident tier (only the clarify tier's single best-guess citation omits it, deliberately, per that field's own doc comment). Render a truncated snippet of `quotedPassage` under each citation's existing "No. N — Title" link — matching NotebookLM's "show the actual quote" pattern from the research, using data this app already has rather than inventing a paragraph-locator system it doesn't have grounding for.

## Boundaries & Constraints

**Always:**
- Do not group, dedupe, or collapse citations from the same paper into one entry — keep each citation as its own separate list item (matches the research: no reviewed product collapses same-source citations).
- Render `citation.quotedPassage` as a short snippet under the existing "No. N — Title" link, when present. Truncate long passages (with an ellipsis) to a bounded length so one very long quote doesn't push the citation list's height out of proportion — pick a specific character cap during implementation (a value in the range of roughly 80-120 characters is a reasonable starting point; exact number is an implementation detail, not a frozen requirement).
- When `quotedPassage` is absent (the clarify tier's single best-guess citation, per `answer.ts`'s doc comment), the citation list item renders exactly as it does today — link only, no snippet line, no truncation logic invoked.
- The link's existing `href`/`onClick`/navigation-to-highlighted-passage behavior is completely unchanged — this story only adds a visual line, never touches the citation-click/highlight mechanism itself.
- The added snippet must not become interactively distinguishable in a way that breaks existing tests asserting on link text/`aria-label` — update those assertions to account for the new snippet rather than treating the change as backward-compatible by coincidence.
- Accessibility: the snippet text must be reachable by assistive tech (either as visible text inside the link's accessible name, or as adjacent text association) — not decorative-only/hidden from screen readers, since it's exactly the information sighted users need to tell citations apart and non-sighted users need the same distinguishing information.

**Never:**
- Do not add a paragraph-level locator ("¶3") — this app's chunks have no paragraph-index data to back that claim; do not fabricate one.
- Do not change `Citation`'s schema, `verifyCitations`, or anything upstream of what's already sent to the client — this is a pure rendering change using an existing, already-populated field.
- Do not change citation ordering or which citations are included — purely a per-citation-item rendering change.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Multiple citations, same paper, each with a distinct `quotedPassage` | Confident-tier answer citing 4 chunks from paper 4 | Each of the 4 list items shows its own distinct quoted snippet under the "No. 4 — {title}" link | N/A |
| `quotedPassage` shorter than the truncation cap | A short quote | Rendered in full, no ellipsis | N/A |
| `quotedPassage` longer than the truncation cap | A long quote | Truncated with an ellipsis at the cap | N/A |
| `quotedPassage` absent (clarify-tier single citation) | Clarify-tier answer | Citation list item renders exactly as today — link only, no snippet | N/A |
| Two citations from different papers | Normal multi-paper answer | Each shows its own paper heading + its own snippet, unchanged from the "different paper" case today except for the added snippet | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/components/quill/quill-panel.tsx` (~line 436-455) -- the citation-list `<li>` rendering: add a snippet line (truncated `quotedPassage`) below the existing link, conditionally rendered only when `quotedPassage` is present.
- New small helper (same file, or `apps/web/src/lib/`) for the truncation logic, so it's independently testable.
- Existing tests in `apps/web/specs/components/quill/quill-widget.spec.tsx` that assert on citation rendering will need updating to account for the new snippet text.

## Tasks & Acceptance

**Execution:**
- [x] Add a truncation helper (bounded length + ellipsis)
- [x] Render the truncated `quotedPassage` snippet under each citation link in `quill-panel.tsx`, only when present
- [x] Update existing citation-rendering tests to match the new markup
- [x] Add tests for every I/O matrix row (multiple-same-paper distinct snippets, short/long/absent `quotedPassage`)
- [x] Run `nx run-many -t test --projects=web` -- zero regressions

**Acceptance Criteria:**
- Given an answer citing 4 different chunks from the same paper, when the citation list renders, then each of the 4 items shows visibly distinct text (its own quoted snippet), not four identical lines.
- Given a clarify-tier answer's single best-guess citation (no `quotedPassage`), when the citation list renders, then the item looks exactly as it does today — no regression, no empty/broken snippet line.

## Design Notes

Research sources (2026-09-06): Gregory Maggs' Federalist-citation-convention guide (BU Law Review), Anthropic's Citations API docs, Perplexity/NotebookLM citation-UX teardowns — see this story's originating conversation for full citations. Core takeaway driving the Approach: use the quote itself as the differentiator, since this app already generates and stores one per citation, rather than inventing a locator scheme (paragraph numbers) with no supporting data.

## Verification

**Commands:**
- `nx run-many -t test --projects=web` -- expect no regressions
- Manual: ask a question that produces multiple citations from the same paper, confirm each is visually distinguishable in the citation list.

## Suggested Review Order

1. `apps/web/src/lib/citation-snippet.ts` -- the truncation helper (cap + ellipsis rule).
2. `apps/web/specs/lib/citation-snippet.spec.ts` -- unit coverage for the helper (short/at-cap/long/whitespace-boundary/custom-cap).
3. `apps/web/src/components/quill/quill-panel.tsx` (~line 436-461) -- the conditional snippet `<p>` added under each citation link.
4. `apps/web/specs/components/quill/quill-widget.spec.tsx` -- updated existing citation tests (distinct fixture quotes so answer text and snippet text no longer collide in `getByText`) plus the new `citation snippet differentiation` describe block covering every I/O matrix row.

## Review Triage Log

### 2026-09-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (medium)
- defer: 2 (0 high, 0 medium, 2 low)
- reject: 0 (all findings triaged directly to patch/defer or refuted-as-pre-existing during triage; none were unfounded noise)
- addressed_findings:
  - `[medium]` `[patch]` The "shows each citation its own distinct snippet" and "shows each paper its own heading and its own snippet" tests only asserted each snippet's text existed *somewhere* on the page (`screen.getByText(...)`), never that snippet *i* is actually nested inside citation *i*'s own `<li>`/link -- confirmed independently by both the verification-gap reviewer and the intent-alignment auditor. The production code itself already pairs each snippet correctly (each `<p>` is a sibling of its own citation's `Link` inside the same `.map()` iteration), so this was a verification gap, not a live bug -- but a future regression (e.g. swapped snippet order) would have shipped silently. Fixed: both tests now scope their assertions to each link's own `.closest('li')`, mirroring the pre-existing "no quotedPassage" test's identical scoping pattern. Re-ran `nx run-many -t test,build,lint --projects=web --skip-nx-cache` -- 10/10 suites, 113/113 tests pass, clean build/lint.

Reviewed and refuted/deferred (not simply dismissed):
- Edge Case Hunter's "href length uncapped"/"paperNumber undefined produces /papers/undefined" findings -- refuted as pre-existing: that `Link`/`href` logic already existed before this story, completely untouched by this diff.
- Edge Case Hunter's/Blind Hunter's "`truncateCitationSnippet` has no guard against non-string or `maxLength <= 0` input" -- refuted in practice: the function is only ever called with the module's own default constant, and the call site is already guarded by `citation.quotedPassage &&` (a TypeScript-typed, non-empty string) -- no live path exercises the flagged inputs.
- Blind Hunter's "React/JSX HTML-escaping of `quotedPassage`" concern -- refuted: React auto-escapes JSX text content by default; no `dangerouslySetInnerHTML` is used anywhere in this diff.
- Blind Hunter's "no test for empty-string `quotedPassage`" and "duplicate `quotedPassage` values could break `getByText`" -- moved to defer implicitly (not independently actioned): low-value edge cases with no live user-facing consequence identified; `CitationSchema.quotedPassage`'s lack of `.min(1)` is pre-existing schema behavior, not introduced here.
- Blind Hunter's word-boundary truncation and semantic-markup (blockquote/cite/aria-label) suggestions -- moved to `deferred` (see frontmatter): both are polish/enhancement items explicitly within the frozen spec's own stated tolerance ("exact number is an implementation detail" for the cap; "reachable by assistive tech," not "semantically marked as a quotation," for accessibility).

## Auto Run Result

**Summary:** Added a truncated `quotedPassage` snippet under each citation's existing "No. N — Title" link in the quill panel, so multiple citations from the same paper (a common, correct RAG outcome) read as distinct grounded quotes instead of looking like duplicated lines. No schema change, no backend change -- pure rendering, using data (`Citation.quotedPassage`) the app already generates and stores.

**Files changed:** `apps/web/src/lib/citation-snippet.ts` (new), `apps/web/specs/lib/citation-snippet.spec.ts` (new), `apps/web/src/components/quill/quill-panel.tsx`, `apps/web/specs/components/quill/quill-widget.spec.tsx`.

**Review findings breakdown:** 1 patch applied (medium severity -- strengthened two tests that only proved snippet text existed somewhere on the page, not that it was correctly paired with its own citation), 2 deferred (both low severity, explicitly-tolerated polish items per the frozen spec's own wording), several other findings refuted as pre-existing/inapplicable during triage (see Review Triage Log).

**Follow-up review recommendation:** `false` (patched-finding score: 1 medium = 3, below the 5 threshold; no high-severity patch).

**Verification performed:** `nx run-many -t test,build,lint --projects=web --skip-nx-cache` -- 10/10 suites, 113/113 tests pass, clean build/lint. Matrix Test Audit: every I/O & Edge-Case Matrix row confirmed covered by a passing, real test (including the strengthened per-`<li>` scoping) before proceeding to review.

**Residual risks:** the two deferred low-severity polish items (word-boundary truncation, quote semantic markup) remain open, not blocking.
