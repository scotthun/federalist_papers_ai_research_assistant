---
title: 'Story 5.2: Chat Persistence & Page-Aware Context'
type: 'feature'
created: '2026-09-02'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      No maximum size or pruning strategy for the persisted conversation -- a very long research
      session could hit sessionStorage's quota, silently disabling further persistence.
    evidence: |-
      The write-through effect's try/catch already degrades gracefully (the conversation keeps
      working in-memory for the rest of the tab session, it just stops persisting), so this is
      low-frequency/low-severity, not a crash -- but no truncation of old turns exists. Revisit if
      a real session is ever observed to grow large enough to matter.
    location: apps/web/src/components/quill/quill-widget.tsx
    severity: low
  - summary: >-
      The context chip's appearance/disappearance isn't announced via aria-live, so a screen
      reader user gets no notice that the search scope changed between "this paper" and "whole
      archive."
    evidence: |-
      Not required by this story's literal AC (which specifies aria-live for the streaming answer
      bubble, Story 5.1, but says nothing about the chip). Real accessibility polish, worth a
      follow-up pass rather than blocking this story.
    location: apps/web/src/components/quill/quill-panel.tsx
    severity: low
baseline_revision: '7789f08fc4592bc4ac7e40281ae1222820f5c145'
---

<intent-contract>

## Intent

**Problem:** The quill widget's conversation (Story 5.1) already survives client-side `<Link>` navigation for free (it's mounted once at the layout level), but a hard reload or direct URL navigation loses it entirely, and the widget has no way to know it's being opened from a specific Paper Reader page — every question always searches the whole archive.

**Approach:** Persist the conversation to `sessionStorage` (write-through on settle, not on every streaming token) so it survives a reload within the same tab but never a new tab. Add a small React Context, populated by a tiny client component the Paper Reader page renders, so the layout-level quill widget learns which paper (if any) is currently being read; when present, show a removable context chip and tell the LLM which paper the user is reading (number + title) as prompt context — **never** a retrieval filter. Retrieval always searches the whole archive; the current paper only shapes how the LLM frames its answer, never which evidence it's allowed to draw from.

> **2026-09-02 product correction:** the original version of this intent called for reusing the retrieval library's existing `paperNumber` filter (a hard `WHERE paper_number = N` before the top-K `LIMIT`) so the ask request would only ever search the current paper. After seeing it built and demoed, the product owner reconsidered: the actual goal was to give the LLM *context* about which paper is open, not to make cross-paper questions unanswerable while reading a specific paper. Confirmed with John (PM) and Sally (UX) — both agreed dropping the hard filter better serves the story's own "I don't want to repeat context" goal, and that the chip's existing copy/aria-label ("Remove paper context") already reads as context, not a scope lock, so no chip-copy change is needed. See the Spec Change Log below for what changed and what was kept.

## Boundaries & Constraints

**Always:**
- Conversation persistence is `sessionStorage` only — no network/DB round trip, no `localStorage` (NFR8/NFR10). Cleared automatically on tab close; a genuinely new tab (not a duplicated/restored one — most browsers do copy `sessionStorage` when a tab is explicitly duplicated or a crashed session is restored, which is outside this AC's "closes the tab, reopens the app in a new tab" scenario) never inherits it — native `sessionStorage` scoping, no code needed for that half.
- Persistence writes are skipped while any message has `status: 'streaming'` (checked in the same effect that would otherwise write) — only the settled state (question added, or an answer reaching `done`/`connection-lost`) triggers a `sessionStorage` write. This avoids adding a write on every streamed token, which would compound the "streaming already feels a little rough" feedback from Story 5.1.
- On restoring from `sessionStorage` (initial mount only), any restored answer message still carrying `status: 'streaming'` is downgraded to `connection-lost` — a real reload has no fetch/reader left to resume it, so leaving it `streaming` would show a permanent cursor with nothing behind it.
- The paper-context chip's presence and the ask request's contextual note to the LLM are the same boolean, driven by the same piece of state — never two independently-tracked flags that could drift (chip visible ⇔ context sent).
- Dismissing the chip resets automatically the moment the *current paper* changes (including changing to "no paper" and back) — implemented as a render-time state adjustment keyed on the announced paper's `paperNumber` (see Review Triage Log: this was originally a `useEffect`, patched to avoid a one-frame stale-state flash), not a value that persists across navigation. This is what makes "does not reappear while remaining on that same page" and "re-evaluates fresh" for a different paper (or the same paper revisited later) both true from one mechanism.
- `apps/api`'s `AskController`/`AskService` gain an *optional* `{ paperNumber, paperTitle }` pair, threaded into `buildAnswerPrompt`'s prompt text as a contextual note — **never** into `retrieveRelevantChunks`'s options. `libs/retrieval`'s existing `RetrieveOptions.paperNumber` filter-before-`LIMIT` mechanism (CAP-2/NFR6) is real and already tested, but this story does not use it — retrieval for a filtered-looking request is identical to an unfiltered one.
- A request body's `paperNumber`/`paperTitle` that don't both parse as valid (a positive integer and a non-empty trimmed string, respectively) are treated as absent (no context, no error) — these fields are client-controlled (our own quill panel), not end-user-typed, so a malformed value degrades to "no paper context" rather than a 400.

**Block If:** None identified.

**Never:**
- Do not persist conversation to `localStorage`, a cookie, or the backend — session-tab-scoped only (NFR10).
- Do not add a `ChatSession`/`ChatMessage` database table — explicit non-goal carried from Epic 5's context.
- Do not build a new client-fetchable `/api/papers/[paperNumber]` route to learn the paper's title — the Paper Reader page (a Server Component) already has the title; it's threaded to the widget via a small Context, not a second fetch.
- Do not apply the current paper as a `retrieveRelevantChunks` filter, or otherwise restrict which paper an answer can cite while the chip is present — that was the original (corrected) design; the current paper is prompt context only.
- Do not show the context chip, or send any paper context, on the Homepage or Browse Papers — those pages render nothing that announces a current paper, so the default (no) context applies automatically.
- Do not persist chip-dismissal across a page reload or new tab — it's ephemeral UI state for "while I keep looking at this specific paper," not part of the conversation.
- Do not change the chip's visible copy or its "Remove paper context" aria-label — UX review (Sally) confirmed the existing wording already reads as context, not a scope lock; only the underlying retrieval behavior changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reload mid-conversation | User has asked ≥1 question, then hard-reloads the same tab | Question/answer history reappears next time the panel is opened | n/a |
| New tab | User opens the app in a brand-new tab (not a reload) | No prior chat history — empty conversation | n/a |
| Reload mid-stream | Reload happens while an answer's `status` was `streaming` | Restored message shows `connection-lost`, not a stuck cursor | n/a |
| Open panel on a Paper Reader page | User opens the panel while viewing `/papers/{N}` | "📄 Federalist No. {N}" chip appears at the top of the message list, titled from that page's own data | n/a |
| Open panel on Homepage/Browse Papers | User opens the panel from `/` or a search results page | No chip; input placeholder alone signals archive-wide scope | n/a |
| Ask with chip present | Chip showing for paper N, user submits a question | `/api/ask` request body includes `paperNumber`/`paperTitle`; the LLM prompt notes the user is reading that paper; retrieval still searches the whole archive and a different paper can still be cited if it's the better answer | n/a |
| Dismiss chip, then ask | User clicks the chip's ✕, then submits a question | Chip gone; request has no `paperNumber`/`paperTitle`; no paper-context note in the prompt (retrieval scope was never affected either way) | n/a |
| Dismiss chip, stay on same paper | Chip dismissed for paper N, user keeps browsing/asking on the same `/papers/N` | Chip does not reappear | n/a |
| Dismiss on N, navigate to M | Chip dismissed for paper N, user clicks a citation/link to a different paper M | Chip re-evaluates fresh and appears again for M | n/a |
| Navigate away and back to N | Chip dismissed for paper N, user goes to Browse Papers, then returns to paper N | Chip reappears (a fresh arrival at N, not a continuous "remaining on that page") | n/a |
| `paperNumber`/`paperTitle` malformed | Request body's `paperNumber` isn't a positive integer, or `paperTitle` isn't a non-empty string (independently or together) | Treated as absent — no paper context sent to the LLM, no 400 | Defensive coercion in `AskController`, not a validation error |

</intent-contract>

## Code Map

- `apps/web/src/components/quill/quill-widget.tsx` -- add: (1) lazy `useState` initializer reading `sessionStorage` (key `quill-chat-history`) for `messages`, sanitizing any `status: 'streaming'` message to `connection-lost`; (2) a write-through `useEffect` on `messages` that skips the write while `messages.some(m => m.role === 'answer' && m.status === 'streaming')`; (3) consume `usePaperContext()` (new); (4) own `chipDismissed` boolean state with a `useEffect` keyed on `currentPaper?.paperNumber` that resets it to `false` on every change; (5) compute `activePaperContext = chipDismissed ? null : currentPaper` and pass it (plus a dismiss callback) down to `QuillPanel`.
- `apps/web/src/components/quill/quill-launcher.tsx` -- read-only reference for the guarded-`sessionStorage`-access pattern (try/catch around `getItem`/`setItem`, lines 27-43) that the new persistence code should mirror. No edits.
- `apps/web/src/components/quill/quill-panel.tsx` -- add a `paperContext: { paperNumber: number; title: string } | null` prop and an `onDismissPaperContext: () => void` prop; render the chip (per DESIGN.md's "Context chip" component spec) above the message list when `paperContext` is non-null; include `paperNumber: paperContext.paperNumber` and `paperTitle: paperContext.title` in the `/api/ask` POST body (line 157's `JSON.stringify({ question: trimmedQuestion })`) when present -- **product correction, 2026-09-02**: this is context for the LLM prompt, not a retrieval filter (see Spec Change Log).
- `apps/web/src/app/api/ask/route.ts` -- **no change**: it already forwards the parsed request `body` verbatim to apps/api (`JSON.stringify(body)`), so an added `paperNumber` field passes through automatically.
- New: `apps/web/src/components/quill/paper-context.tsx` -- `PaperContext` (React Context, default `{ currentPaper: null, setCurrentPaper: noop }` so it's safe with no provider ancestor in tests), `PaperContextProvider` (holds `currentPaper` state), `usePaperContext()` hook.
- New: `apps/web/src/components/quill/announce-paper-context.tsx` -- `'use client'` component `AnnouncePaperContext({ paperNumber, title })`; on mount/paperNumber-or-title change calls `setCurrentPaper({ paperNumber, title })`, clears (`setCurrentPaper(null)`) on unmount. Kept as its own file because the Reader page itself is an async Server Component and can't carry a `'use client'` directive.
- `apps/web/src/app/layout.tsx` -- wrap `{children}` and `<QuillWidget />` together in the new `<PaperContextProvider>` (currently just renders them as plain siblings inside `<body>`, lines 16-21).
- `apps/web/src/app/papers/[paperNumber]/page.tsx` -- in `PaperReaderPage`'s success branch (line 152, alongside `<PaperReader paper={result.paper} highlight={highlight} />`), render `<AnnouncePaperContext paperNumber={result.paper.paperNumber} title={result.paper.title} />`.
- `apps/api/src/app/ask/ask.controller.ts` -- add `paperNumber?: unknown`/`paperTitle?: unknown` to `AskRequestBody` (line 8-10); in `ask()` (line 33), coerce both (`Number.isInteger(body.paperNumber) && body.paperNumber > 0`; `typeof body.paperTitle === 'string'` non-empty after trim) -- only when **both** are valid, build a `currentPaper: { paperNumber, title }` object, else `undefined` -- and pass as a second argument: `this.askService.ask(trimmedQuestion, currentPaper)`.
- `apps/api/src/app/ask/ask.service.ts` -- `AskService.ask` (line 164) gains an optional `currentPaper?: { paperNumber: number; title: string }` second parameter, threaded through `resolveOutcome`/`answerConfidently`/`tryGenerate` into `buildAnswerPrompt`'s new parameter (below) -- **not** into `retrieveRelevantChunks`'s options, which stays exactly `{ topK: TOP_K }` (product correction, 2026-09-02 -- the original version of this line threaded it into the retrieval filter instead; see Spec Change Log).
- `apps/api/src/app/ask/answer-prompt.ts` -- `buildAnswerPrompt` (line 42) gains an optional fourth parameter `currentPaper?: { paperNumber: number; title: string }`; when present, prepend a short contextual note to the prompt (e.g. "The user is currently reading Federalist No. {N}: \"{title}\". This is context only -- you may still answer using evidence from any paper if that's the better answer.") before the `QUESTION:` line.
- `libs/retrieval/src/lib/retrieval.ts` -- `RetrieveOptions`/`retrieveRelevantChunks` unchanged; this story deliberately does not call its `paperNumber` filter option at all. **2026-09-03 follow-up:** new exported `getAllChunksForPaper(dataSource, paperNumber)` -- a plain SQL lookup (no embedding, no `AIProvider`) returning every chunk for a paper in `chunk_index` order, `score` always `1` (a placeholder, never a real similarity value).
- `apps/web/src/app/global.css` -- reuse existing `--color-quill-surface-chip`/`--color-quill-accent-gold`/`--color-quill-ink-secondary` tokens (already added in Story 5.1) for the chip; no new tokens expected.
- `apps/web/specs/components/quill/quill-widget.spec.tsx` -- extend with persistence (write-skipped-while-streaming, restore-and-sanitize-on-mount) and chip-dismissal-reset-on-paper-change cases.
- New: `apps/web/specs/components/quill/paper-context.spec.tsx` -- covers `PaperContextProvider`/`usePaperContext()` defaults and updates, and `AnnouncePaperContext`'s mount/update/unmount behavior together (tightly coupled, kept in one file).
- `apps/web/specs/papers/paper-number/page.spec.tsx` -- add a case asserting `AnnouncePaperContext` is rendered with the fetched paper's number/title (e.g. via a test-only context consumer wrapping the rendered page output).
- `apps/api/src/app/ask/ask.controller.spec.ts` -- add cases: forwards a numeric `paperNumber` as the service's second argument; a non-numeric/absent `paperNumber` calls the service with `undefined` (not a 400).
- `apps/api/src/app/ask/ask.service.spec.ts` -- add a case asserting that calling `service.ask(question, paperNumber)` includes that value among the bound SQL parameters passed to the faked `dataSource.query` (proving it reached `retrieveRelevantChunks`'s options — SQL correctness itself stays `libs/retrieval`'s own test responsibility).

## Tasks & Acceptance

**Execution:**
- `apps/web/src/components/quill/paper-context.tsx` -- add `PaperContext`/`PaperContextProvider`/`usePaperContext` -- the shared mechanism the layout-mounted widget and the page-mounted announcer both need, with no prop-drilling through `{children}`.
- `apps/web/src/components/quill/announce-paper-context.tsx` -- add the small client announcer component -- lets a Server Component page (`PaperReaderPage`) participate in client Context without itself becoming a client component.
- `apps/web/src/app/layout.tsx` -- wrap `{children}` + `<QuillWidget />` in `<PaperContextProvider>` -- makes the context available to both the announcer (inside `children`) and the widget (its sibling).
- `apps/web/src/app/papers/[paperNumber]/page.tsx` -- render `<AnnouncePaperContext>` alongside `<PaperReader>` -- the one place a paper is known to be "currently being read."
- `apps/web/src/components/quill/quill-widget.tsx` -- add `sessionStorage` read (with streaming-status sanitization) on init and a skip-while-streaming write-through effect for `messages`; consume `usePaperContext()`; add `chipDismissed` state reset-on-paper-change; compute and pass down `activePaperContext` + dismiss callback -- the persistence and page-awareness both live where `messages`/`isOpen` already live, consistent with Story 5.1's "one owner" design.
- `apps/web/src/components/quill/quill-panel.tsx` -- accept and render the context chip from the new props; include `paperNumber`/`paperTitle` in the ask request body when present -- keeps `QuillPanel` presentational (per Story 5.1's split) while still surfacing/using the new state.
- `apps/api/src/app/ask/ask.controller.ts` -- accept and coerce an optional `{ paperNumber, paperTitle }` pair, pass to `AskService.ask` -- the request-validation boundary, same role it already plays for `question`.
- `apps/api/src/app/ask/ask.service.ts` -- thread the current paper into `buildAnswerPrompt`, **not** into `retrieveRelevantChunks`'s options.
- `apps/api/src/app/ask/answer-prompt.ts` -- accept the current paper and prepend a contextual note to the prompt when present.
- Unit-test every I/O Matrix row (see specs listed in Code Map).

**Acceptance Criteria:**
- Given an existing conversation in the current tab, when the user reloads or navigates by URL, then the chat history remains present next time the panel is opened, with no network/database round trip.
- Given the user closes the tab and reopens the app in a new tab, then no prior chat history is restored.
- Given the panel opened on a Paper Reader page, when it renders, then a removable "📄 Federalist No. {N}" context chip appears, pre-filled with that paper's title.
- Given the context chip is present, when a question is submitted, then the request tells the LLM the user is reading that paper (number + title) as prompt context only; retrieval still searches the whole archive and a different paper can still be cited when it's the better answer.
- Given the context chip is present, when the user clicks its ✕, then the chip is removed, the next question no longer includes that paper context, and the chip does not reappear while the user remains on that same Paper Reader page.
- Given the chip was removed while reading paper N, when the user navigates to a different Paper Reader (paper M), then the chip re-evaluates fresh and appears again for M.
- Given the panel is opened from the Homepage or Browse Papers, then no context chip appears.

## Spec Change Log

### 2026-09-02 — Product correction: context, not a retrieval filter

**Triggering finding:** After the first implementation shipped and was demoed, the product owner reconsidered the original AC's choice to apply the current paper as a hard `paperNumber` retrieval filter (reusing `libs/retrieval`'s existing filter-before-limit mechanism). Pulse-checked with John (PM) and Sally (UX): both agreed a hard filter works against the story's own stated goal ("so I don't ... have to repeat context") by making a genuinely cross-paper question unanswerable while the chip is present — a strictly worse outcome than doing nothing.

**What was amended:** `docs/planning/epics.md`'s Story 5.2 AC and this spec's Intent/Boundaries/I/O Matrix/Code Map/Tasks were rewritten so the current paper is threaded into the LLM prompt as contextual framing (`buildAnswerPrompt` gains a `currentPaper` parameter) instead of into `retrieveRelevantChunks`'s options. `apps/api`'s `AskController`/`AskService` now carry `{ paperNumber, paperTitle }` end-to-end to the prompt builder rather than to the retrieval filter. `docs/implementation/epic-5-context.md`'s matching bullet was also corrected.

**Known-bad state avoided:** Shipping (or leaving shipped) a chip that silently makes the archive-wide assistant answer only from one paper while reading it — directly contradicting the product owner's actual intent and, per UX review, misleading given the chip's own "remove paper context" framing.

**KEEP -- preserved unchanged, re-derive around these:**
- The `sessionStorage` persistence mechanism (write-through skipped while streaming, restore-with-shape-validation, `connection-lost` downgrade) -- entirely unrelated to this correction, do not touch.
- The `PaperContext`/`PaperContextProvider`/`usePaperContext`/`AnnouncePaperContext` mechanism for learning the current paper -- unchanged; only what the widget *does* with that value on the ask request changes.
- The chip's rendering, visible copy, and `aria-label="Remove paper context"` -- UX review confirmed these already read as context, not a scope lock; do not reword.
- The chip-dismissal-resets-on-paper-change mechanism (the render-time state adjustment, not the earlier `useEffect` version already patched out in the prior review pass) -- unchanged; dismissal still means "don't send this paper's context," just no longer "don't filter by it."
- All of Story 5.1's untouched surfaces (streaming, citation verification, citation navigation) -- this correction only touches the current-paper-context plumbing.

### 2026-09-03 — Follow-up: pin the current paper's full content as extra evidence

**Triggering finding:** Manual testing of the 2026-09-02 correction surfaced a real gap: a vague, low-signal question ("give me a TLDR", "summarize this paper") asked while the context chip is showing had *nothing* anchoring its embedding-similarity search to the paper actually being read -- one real example retrieved five completely unrelated papers, with the current paper absent from the results entirely. The hard filter this story removed had accidentally been a crutch for exactly this weak-signal case (a `WHERE paper_number = N` guarantees the current paper's chunks come back no matter how generic the question is); removing it exposed that semantic search alone doesn't handle "summarize whatever I'm looking at" well.

**What was amended:** Rather than resurrecting a filter (or a second *ranked* similarity search, which would need its own embedding call -- another dependency on the same Gemini endpoint that was independently observed 503-ing under load during this session), `libs/retrieval` gained a new `getAllChunksForPaper(dataSource, paperNumber)` -- a plain SQL lookup, no embedding, no `AIProvider` call at all, returning every chunk for that paper in reading order. `AskService.ask` now calls it, and appends its result to the evidence set, whenever `currentPaper` is set and that paper *didn't* already appear in the unrestricted top-K on its own merits. The tier decision (`chunks[0]?.score`) is captured **before** this append, specifically so the pinned chunks' placeholder `score: 1` (there's nothing to rank them against) can never look like the best match and wrongly promote a low-signal question to the confident tier.

**Known-bad state avoided:** A user asking about the paper they're visibly looking at getting an answer sourced from five unrelated papers, or a confident-sounding answer that's secretly ungrounded because a placeholder score leaked into the tier decision.

**KEEP -- preserved unchanged, re-derive around these:**
- Everything from the 2026-09-02 entry above -- this is additive on top of it, not a reversal.
- The unrestricted `retrieveRelevantChunks` call and its role in the tier decision -- a cross-paper question with real semantic signal continues to work exactly as before; pinning only adds evidence, it never removes or reorders the unrestricted results.
- Citation verification -- pinned chunks are just as real/`chunkId`-verified as unrestricted ones once appended; no separate trust path was introduced for them.

### 2026-09-03 — Second follow-up: force the confident tier when a specific paper is pinned

**Triggering finding:** Live testing of the pinning follow-up above surfaced that pinning alone wasn't enough: a meta/summary-style question ("give me a TLDR", "summarize this paper") structurally can't score well against `decideAnswerTier`'s archive-wide content-similarity gate, no matter which paper is pinned, because the question text doesn't resemble any passage's *content* -- it's a request about the *form* of the answer, not semantically close to the paper's subject matter. So these questions kept landing in `clarify`/`refuse`, where the LLM is never called at all, and the pinned evidence never got used.

**What was amended:** `AskService.ask` now forces the tier to `confident` whenever `currentPaper` is set, regardless of the raw archive-wide score (`decideAnswerTier`'s own result, still computed and now logged separately as `retrievalTier`, purely for observability). This doesn't weaken `decisions.md`'s "Confidence tiering" principle (never trust the LLM's self-reported confidence) -- it swaps out *which* deterministic, code-decided signal gates the LLM call: the UI explicitly telling us which paper is relevant is a stronger signal than raw embedding similarity for exactly this class of question, and citation verification (the documented *actual* safety net) still applies unchanged -- a forced confident-tier attempt that can't produce a verified citation still fails safe to refuse, exactly like every other confident-tier attempt.

**Known-bad state avoided:** A user on a specific paper's page asking a plain, ordinary question ("summarize this", "TLDR") and reliably getting a non-answer (a templated guess or a blanket refusal) instead of a real, grounded response -- defeating the entire point of pinning the paper's content in the first place.

**KEEP -- preserved unchanged, re-derive around these:**
- Everything from both entries above -- additive, not a reversal.
- Pinning itself (`getAllChunksForPaper`, appended after the tier decision) -- unchanged; it's still what supplies the evidence the now-always-attempted LLM call needs.
- Citation verification and the one-retry-then-fail-safe policy -- exercised identically regardless of how the confident tier was reached.
- `clarifyOutcome`/`refuseOutcome` -- reverted to their original, `currentPaper`-unaware form, since neither can run anymore while `currentPaper` is set (an intermediate version of `clarifyOutcome` briefly preferred `currentPaper` for its guess; that's now moot and was removed along with its tests).

## Review Triage Log

### 2026-09-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9 (high 1, medium 2, low 6)
- defer: 2 (high 0, medium 0, low 2)
- reject: 6 (high 0, medium 0, low 6)
- addressed_findings:
  - `high` `patch` No test exercised the real `apps/web/src/app/layout.tsx` `RootLayout` wiring `PaperContextProvider` around both `{children}` and `<QuillWidget />` -- every existing test built its own local provider tree, so a regression moving `<QuillWidget />` outside the provider in `layout.tsx` would silently disable the chip/filter feature end-to-end with all tests green. Fixed by adding a test that renders the real `RootLayout`.
  - `medium` `patch` `chipDismissed`'s reset was a `useEffect` keyed on `currentPaper?.paperNumber` -- the classic "adjust state in an effect" pattern, which renders one frame with the stale dismissal value before the passive effect corrects it. Fixed by adjusting the state during render (comparing against a tracked last-seen `paperNumber` and calling `setState` in the render body) per React's own guidance, so the reset lands in the same render pass.
  - `medium` `patch` `restoreMessages()` only checked `Array.isArray` on the parsed JSON, never that each element actually has a valid `role`/`status`/shape -- a stale or version-skewed `sessionStorage` payload could pass through unsanitized and crash/misrender. Fixed with a per-element shape guard (mirrors this codebase's existing `isAnswer`/`isPaperDetail` convention), falling back to an empty conversation on any invalid element.
  - `low` `patch` `AskController`'s `paperNumber` coercion accepted any finite number, including negative/zero/fractional values, which would reach a SQL bound parameter for an integer column. Tightened to `Number.isInteger(...) && ... > 0`.
  - `low` `patch` The `sessionStorage` key was a separately-declared string literal in both the component and its spec. Exported `CHAT_HISTORY_SESSION_KEY` and imported it in the test.
  - `low` `patch` The "skips the write while streaming" test's core assertion was nested inside a conditional that could pass vacuously if no mid-stream write ever fired for an unrelated reason. Made the assertion unconditional.
  - `low` `patch` The SQL-bound-parameters test for `paperNumber` only checked `.toContain(51)`, which a coincidental unrelated parameter could also satisfy. Strengthened by comparing against a baseline call without `paperNumber`.
  - `low` `patch` The chip's 📄 emoji wasn't wrapped in `aria-hidden="true"`, inconsistent with the launcher's own 🪶 emoji in `quill-launcher.tsx` (Story 5.1). Fixed to match.
  - `low` `patch` (doc-only) The spec's/code comment's claim that "a new tab never inherits sessionStorage" overstated the guarantee -- most browsers do copy `sessionStorage` on an explicit tab duplication or crashed-session restore. Softened the wording in this spec's Boundaries and will flag the matching code comment for the same wording fix.

## Design Notes

**Why a Context instead of prop-drilling or a new fetch:** `QuillWidget` is mounted once at the root layout, as a sibling of `{children}` — it has no props and no relationship to whatever page is currently rendered inside `{children}`. `PaperReaderPage` is an async Server Component that already knows the paper's number/title from its own server-side fetch. Rather than inventing a client-fetchable `/api/papers/[paperNumber]` route so the widget could re-fetch that same data (a real network round trip for data the page already has, and a route Story 5.1 deliberately chose not to build), a small React Context lets the page *tell* the widget what it already knows. `AnnouncePaperContext` is a separate file specifically because `page.tsx`'s default export is an async Server Component — a file can't mix a `'use client'` directive with that.

**Why chip-dismissal resets on every paper-context change, not just "different paper":** The AC text says the chip "does not reappear while the user remains on that same Paper Reader page," and separately that navigating to a *different* paper "re-evaluates fresh." Read literally, "remains on" is about not leaving the page at all — it doesn't say what happens if the user leaves and later comes back to the *same* paper. Tying the reset to every change of `currentPaper?.paperNumber` (including transitions through `null`, i.e. leaving to a non-paper page) treats every fresh arrival at a paper — even a repeat visit — as a new "remaining on this page" episode, which is the more literal reading of the AC and requires no extra memory (no set of previously-dismissed paper numbers to accumulate and eventually reconsider stale).

**Why persistence writes skip while streaming:** Immediately after shipping Story 5.1, manual testing surfaced that the token-by-token reveal already feels a little mechanical. Writing to `sessionStorage` (a synchronous, blocking API) on every one of the many `setMessages` calls during a token-by-token reveal would add work on the main thread precisely during the part of the experience already flagged as rough, for a persistence guarantee that doesn't need per-token granularity — the answer is going to be marked `connection-lost` on a real reload mid-stream anyway (see next note). Persisting only once a message *settles* (`done`/`connection-lost`) or a new question is appended keeps the write count proportional to conversation turns, not conversation tokens.

**Why a restored `streaming` message is downgraded to `connection-lost`:** If a reload happens to be captured mid-stream despite the above (e.g. the tab crashes rather than reloading cleanly, or a future change writes more eagerly), a restored message stuck at `status: 'streaming'` would show a permanent trailing cursor with no fetch behind it ever completing it. Downgrading to the existing `connection-lost` status on restore reuses Story 5.1's own "partial text stays visible, quiet inline error, no auto-retry" handling rather than inventing a new state.

## Verification

**Commands:**
- `npx nx test web` -- expected: all specs pass, including new/extended quill, paper-context, page, and API specs.
- `npx nx test api` -- expected: `ask.controller.spec.ts`/`ask.service.spec.ts` pass with the new `paperNumber` cases.
- `npx nx lint web` -- expected: no new lint errors.
- `npx nx build web` -- expected: production build succeeds.

**Manual checks (if no CLI):**
- Ask a question, reload the tab, reopen the panel, confirm the conversation is still there; open the app in a brand-new tab and confirm it's empty. Open the panel on a Paper Reader page, confirm the chip appears with the right title, ask a question that's actually best answered by a *different* paper, and confirm the answer still cites that other paper (proving there's no hard filter); dismiss the chip, ask a question, confirm (via network tab) no `paperNumber`/`paperTitle` was sent; navigate to a different paper via a citation and confirm the chip reappears.

## Auto Run Result

**Summary:** The quill conversation now survives a hard reload/direct URL navigation within the same tab via a guarded `sessionStorage` write-through (skipped while any answer is still streaming, to avoid adding per-token write overhead on top of the streaming-feel feedback from Story 5.1), and never carries over into a genuinely new tab. A new `PaperContext` (provided at the root layout, populated by a small announcer component the Paper Reader page renders) lets the layout-mounted quill widget learn which paper is currently being viewed without a second network fetch; when present, a removable "📄 Federalist No. {N}" chip appears and threads that paper's number into the ask request as a retrieval filter, reusing `libs/retrieval`'s existing, already-tested `paperNumber` filter-before-limit option end to end through `AskController`/`AskService`.

**Files changed:**
- `apps/web/src/components/quill/paper-context.tsx` (new) -- `PaperContext`/`PaperContextProvider`/`usePaperContext`, safe default with no provider ancestor.
- `apps/web/src/components/quill/announce-paper-context.tsx` (new) -- client announcer rendered by the (async, Server Component) Paper Reader page to report/clear the current paper.
- `apps/web/src/components/quill/quill-widget.tsx` -- `sessionStorage` restore-with-shape-validation on init, write-through effect skipped while streaming, exported `CHAT_HISTORY_SESSION_KEY`; `chipDismissed` reset now derived during render (not via `useEffect`) to avoid a one-frame stale-state flash; computes `activePaperContext` as the single source for chip visibility and the ask filter.
- `apps/web/src/components/quill/quill-panel.tsx` -- renders the context chip (dismissible, `aria-hidden` emoji) and includes `paperNumber` in the `/api/ask` body when present.
- `apps/web/src/app/layout.tsx` -- wraps `{children}` + `<QuillWidget />` in `<PaperContextProvider>`.
- `apps/web/src/app/papers/[paperNumber]/page.tsx` -- renders `<AnnouncePaperContext>` alongside `<PaperReader>`.
- `apps/api/src/app/ask/ask.controller.ts` -- accepts and strictly coerces an optional `paperNumber` (positive integer or absent, never a 400).
- `apps/api/src/app/ask/ask.service.ts` -- `ask(question, paperNumber?)` threads into the existing `retrieveRelevantChunks` options.
- New/extended specs: `apps/web/specs/app/layout.spec.tsx` (new), `apps/web/specs/components/quill/paper-context.spec.tsx` (new), `apps/web/specs/components/quill/quill-widget.spec.tsx`, `apps/web/specs/papers/paper-number/page.spec.tsx`, `apps/api/src/app/ask/ask.controller.spec.ts`, `apps/api/src/app/ask/ask.service.spec.ts`.

**Review findings breakdown:**
- Patches applied: 9 (high 1, medium 2, low 6) -- a missing test for the real `layout.tsx` provider wiring (the actual production assembly point for this whole feature), a React state-adjustment anti-pattern in the chip-dismissal reset, unvalidated `sessionStorage` restore shape, loose `paperNumber` integer coercion, a duplicated session-storage-key constant, two weak test assertions, a missing `aria-hidden` on the chip emoji, and an overstated "new tab never inherits sessionStorage" claim softened in both the spec and the matching code comment.
- Deferred: 2 (low 2) -- no size/pruning strategy for the persisted conversation against `sessionStorage`'s quota; no `aria-live` announcement when the context chip appears/disappears. See frontmatter `deferred`.
- Rejected: 6 -- a speculative `AnnouncePaperContext` mount/unmount race (not reachable given this app's simple synchronous page-swap transitions), chip-dismissal keyed on `paperNumber` only and not `title` (titles are static ingested content, never change per paper), a stale-paperNumber-after-renumbering concern (static corpus), `/api/ask` passing through an untyped `paperNumber` for any caller (a pre-existing trust boundary from Story 5.1, not newly widened), and the intent-alignment auditor's observations that tests are jsdom-only (not real multi-tab/navigation) and that persistence binds to component mount rather than the literal "panel open" moment -- both correct descriptively but not defects: jsdom-only testing is this codebase's existing, established convention, and mount-based persistence is a faithful realization of the AC's actual required behavior.

**Follow-up review recommendation:** `true` -- this pass's patch findings included one `high` severity item (the untested `layout.tsx` wiring), which alone triggers a recommended follow-up pass regardless of the weighted score.

**Verification performed:** `npx nx test web` (96/96 passing, 9 suites), `npx nx test api` (179/179 passing, 17 suites), `npx nx lint web`/`npx nx lint api` (0 errors), `npx nx build web` (succeeds) -- all re-run and confirmed green after the patch pass. All 11 I/O & Edge-Case Matrix rows are covered by at least one passing test.

**Residual risks:** The two deferred items above (conversation-size/quota handling; chip-visibility `aria-live`) are tracked in frontmatter `deferred` for future attention, not blocking this story's acceptance criteria. Manual end-to-end browser verification (reload/new-tab/chip behavior against a real running app) was not performed in this session -- only automated tests, lint, and build.

## Auto Run Result — Round 2 (Product Correction, 2026-09-02)

**Summary:** Per the Spec Change Log entry above, the current paper is now threaded into the LLM prompt as contextual framing only, never applied as a `retrieveRelevantChunks` filter. Retrieval always searches the whole archive; a cross-paper question can still be answered/cited correctly while the context chip is present.

**Files changed:**
- `apps/api/src/app/ask/answer-prompt.ts` -- new exported `CurrentPaper` type; `buildAnswerPrompt` gained an optional `currentPaper` parameter, prepending a non-restrictive contextual note before `QUESTION:` when present.
- `apps/api/src/app/ask/ask.service.ts` -- `ask()`'s second parameter is now `currentPaper?: CurrentPaper`, threaded through the confident-tier call chain (including the one retry) into `buildAnswerPrompt`; the `retrieveRelevantChunks` call reverted to `{ topK: TOP_K }` with no `paperNumber` option.
- `apps/api/src/app/ask/ask.controller.ts` -- `AskRequestBody` gained `paperTitle?: unknown`; a `currentPaper` object is only built when both `paperNumber` (positive integer) and `paperTitle` (non-empty trimmed string) independently validate.
- `apps/web/src/components/quill/quill-panel.tsx` -- the ask request body now includes `paperTitle` alongside `paperNumber`.
- Updated specs: `answer-prompt.spec.ts` (new cases), `ask.controller.spec.ts` (replaced `paperNumber`-only cases with `currentPaper` validation cases), `ask.service.spec.ts` (replaced the SQL-bound-params filter test with prompt-content assertions, plus a case proving `paperNumber` never reaches the SQL params even when `currentPaper` is supplied), `quill-widget.spec.tsx` (expects `paperTitle` in the request body).

**Verification performed:** `npx nx test web` (96/96 passing), `npx nx test api` (189/189 passing), `npx nx lint web`/`npx nx lint api` (0 errors), `npx nx build web` (succeeds).

**Residual risk:** Real end-to-end confirmation that a cross-paper question gets correctly answered/cited while the chip is showing was not run against a live LLM in this session -- only unit-level prompt-text assertions confirm the contextual note is present and worded as non-restrictive.

## Auto Run Result — Round 3 (Follow-up, 2026-09-03: pin current paper as extra evidence)

**Summary:** Manual live testing of Round 2 surfaced a real gap -- a vague question ("give me a TLDR") while the chip was showing retrieved five unrelated papers, missing the current paper entirely. Fixed by pinning the current paper's full content (via a new, embedding-free `getAllChunksForPaper` lookup) as extra evidence whenever it doesn't already appear in the unrestricted top-K -- additive only, tier decision still based solely on the unrestricted search's own top score.

**Files changed:**
- `libs/retrieval/src/lib/retrieval.ts` -- new exported `getAllChunksForPaper(dataSource, paperNumber)`.
- `libs/retrieval/src/lib/retrieval.spec.ts` -- new unit tests for it.
- `apps/api/src/app/ask/ask.service.ts` -- `ask()` now pins the current paper's chunks (best-effort; a failure here degrades to the unrestricted results alone) when it's missing from the unrestricted results; tier is captured before pinning so the pinned chunks' placeholder `score: 1` can never inflate it.
- `apps/api/src/app/ask/ask.service.spec.ts` -- new tests: pinned chunks reach the LLM and can be cited; the placeholder score never promotes the tier; no second lookup when the paper's already present; graceful degradation on lookup failure.

**Verification performed:** `npx nx test api` (193/193 passing), `npx nx test web`/`npx nx test retrieval` (cached green, unaffected), `npx nx lint api`/`npx nx lint retrieval` (0 errors), `npx nx build api` (succeeds).

**Residual risk:** Not yet re-verified live in the browser against the actual running app after this change (pending).

## Auto Run Result — Round 4 (Second follow-up, 2026-09-03: force confident tier for a pinned paper)

**Summary:** Live testing of Round 3 showed the pinning fix wasn't sufficient on its own -- meta/summary-style questions ("TLDR", "summarize this paper") kept landing in `clarify`/`refuse` (no LLM call at all) regardless of pinning, since the tier decision is a pure content-similarity score check unrelated to *what kind* of question was asked. Fixed by forcing the confident tier whenever `currentPaper` is set, so the LLM always gets a real chance at a grounded answer; citation verification remains the actual safety net, unchanged.

**Files changed:**
- `apps/api/src/app/ask/ask.service.ts` -- `ask()` now computes `retrievalTier` (the raw decision, logged for observability) separately from the effective `tier` (forced to `'confident'` when `currentPaper` is present); `logRequest` gained a `retrievalTier` param and logs a new `tierOverriddenByCurrentPaper` boolean. `clarifyOutcome` reverted to its original `currentPaper`-unaware form (it can no longer run at all while `currentPaper` is set, making the intermediate Round-3-and-a-half version of it dead code).
- `apps/api/src/app/ask/ask.service.spec.ts` -- removed the now-obsolete tests asserting the tier *stayed* `clarify` with `currentPaper` present; added a new "forces the confident tier" suite covering: LLM called despite a clarify- or refuse-level raw score, the forced call still fails safe to refuse on a bad citation, and both `tierOverriddenByCurrentPaper` log states.

**Verification performed:** `npx nx test api` (197/197 passing, 17 suites), `npx nx lint api` (0 errors), `npx nx build api` (succeeds).

**Residual risk:** Not yet re-verified live in the browser against the actual running app after this change (pending) -- Gemini's `gemini-3.6-flash` was observed 503-ing under load during this session's manual testing, independent of anything in this codebase, which may make a live confident-tier check flaky to reproduce on demand.
