---
title: 'Story 5.1: Quill Widget — Launcher, Panel & Streaming Ask'
type: 'feature'
created: '2026-09-02'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context: []
warnings: ['oversized']
deferred:
  - summary: >-
      The quill panel has no focus trap, no Escape-to-close, and doesn't return focus to the
      launcher button when closed.
    evidence: |-
      The AC requires the launcher/panel to be "fully keyboard-operable" (WCAG 2.2 AA). A
      keyboard user can already reach and activate the collapse/close control via Tab+Enter, so
      the panel is technically closable without a mouse, but a dialog-like widget conventionally
      supports Escape-to-close and restores focus to its trigger on close -- both absent here.
    location: apps/web/src/components/quill/quill-panel.tsx
    severity: medium
  - summary: >-
      apps/web/src/lib/ask-stream.ts's parseAskStreamEventLine does not validate the shape of a
      'done' event's fields (e.g. citations array, confidence enum) before casting.
    evidence: |-
      Currently low risk since both the writer (route.ts) and reader (quill-panel.tsx) are the
      same codebase and the wire format is internally controlled, not exposed to third parties --
      but the cast is unchecked, so a future change to either side could silently produce a
      malformed event the other side trusts blindly.
    location: apps/web/src/lib/ask-stream.ts
    severity: low
  - summary: >-
      apps/web/src/lib/ask-stream.ts's chunkIntoWords/serializeAskStreamEvent/
      parseAskStreamEventLine have no dedicated unit spec exercising malformed-input edge cases
      directly (only indirectly via ask-route.spec.ts/quill-widget.spec.tsx).
    evidence: |-
      A direct spec would isolate wire-format regressions from the route/widget integration tests
      that currently carry this coverage implicitly.
    location: apps/web/src/lib/ask-stream.ts
    severity: low
baseline_revision: '3fe6ac4670834617807d24c9ae482bdd3115a02f'
---

<intent-contract>

## Intent

**Problem:** The archive-wide Q&A surface today is `AskQuestion`, an inline component on the homepage only, with a plain-text (non-clickable) citation list and no streaming — it isn't available from Browse Papers or a Paper Reader page, and Story 3.3's citation-navigation was never built.

**Approach:** Replace `AskQuestion` with a floating quill launcher + popup panel mounted in the root layout (available on every page), backed by a new client-perceived streaming contract layered on top of the existing, unmodified `POST /api/ask` (apps/api) call — apps/web's own `/api/ask` route resolves the full, already-verified `Answer` first, then relays it to the browser as an incremental NDJSON stream so the confident tier reveals token-by-token while clarify/refuse render instantly.

## Boundaries & Constraints

**Always:**
- `apps/api`'s `AskController`/`AskService`/citation verification are unmodified — the LLM call and citation verification still happen in one synchronous request; apps/web's own `/api/ask` route handler is the only place that adds streaming, by relaying the already-complete/verified `Answer` to the browser as incremental chunks.
- Citations render only after the full response is verified (already guaranteed by `AskService`) — never mid-stream.
- Tier is derived from `answer.confidence === 'high'` (confident) vs. anything else (clarify/refuse) — never a new/separate tier field.
- `<QuillWidget />` mounts once, as a sibling of `{children}` inside `RootLayout`'s `<body>` (`apps/web/src/app/layout.tsx`), so its React state (open/closed, conversation) survives Next.js client-side navigations (`<Link>`) without needing persistence — Story 5.2 owns cross-tab/sessionStorage persistence, not this story.
- Citation and related-paper-style links to a Paper Reader use Next's `<Link>` (client-side transition), never a hard `<a href>` reload — required for "collapses back to the launcher without clearing the conversation" to hold without inventing storage this story doesn't own.
- New visual tokens (Parchment & Manuscript: colors, radii, dog-ear shape) are added as new `@theme` CSS vars in `apps/web/src/app/global.css`, additive to the existing shadcn palette — never overwrite/repurpose the existing `--color-*` vars other pages (Browse Papers, Paper Reader, `ui/button.tsx`, `ui/card.tsx`) already depend on.
- `AskQuestion` and its render call in `apps/web/src/app/page.tsx` are deleted, along with `apps/web/specs/components/ask-question.spec.tsx` — the quill panel is the only ask surface once this ships.

**Block If:** None identified — see Design Notes for how the apparent "reuse `PaperReader`/`/api/papers/[paperNumber]`" and "selectedCitation/paperState machine" epic notes were resolved without a human decision.

**Never:**
- Do not add a new apps/api endpoint or change `AskService`'s LLM-calling architecture to produce genuine token-level LLM streaming — out of scope; "streaming" here is the already-complete answer relayed incrementally.
- Do not port `AskQuestion`'s `EXAMPLE_PROMPTS` suggestion chips into the quill panel — not in this story's AC.
- Do not add `sessionStorage`/cross-tab chat persistence or a paper-context chip — Story 5.2.
- Do not add a "related papers" list — Story 5.3.
- Do not create `apps/web/src/app/api/papers/[paperNumber]/route.ts` — unnecessary; citation navigation is a plain page link, and the existing Server Component page already fetches paper data itself.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Confident answer | `/api/ask` relay resolves `confidence: 'high'` | Answer bubble reveals word-by-word with trailing cursor + "streaming…" caption, `aria-live="polite"`; citations attach only in the final NDJSON event | n/a |
| Clarify/refuse answer | `confidence !== 'high'` | Single NDJSON `done` event, no `token` events; bubble renders instantly, no cursor | n/a |
| Stream ends without a `done` event | Reader's `.read()` errors, or the stream closes early | Partial text (if any) stays visible; inline "Connection lost — try asking again" message; send control re-enables; no auto-retry | Detected in the client reader loop, not a thrown/unhandled rejection |
| Double submit while streaming | User presses Enter/clicks send again before `done` | No second request is sent | Send control is `disabled` while status is `streaming` |
| Citation click | Citation link with a `quotedPassage` | Client-side `<Link>` navigation to `/papers/{n}?highlight=...#cited-passage`; matched paragraph highlighted; panel collapses to launcher; conversation state unchanged | n/a |
| Citation with no `quotedPassage` | `quotedPassage` absent (schema-optional) | Link navigates to `/papers/{n}` with no highlight param/hash | n/a |
| First visit this session | No `quill-tooltip-shown` in `sessionStorage` | Launcher pulses once, tooltip auto-opens, then both are suppressed for the rest of the session | n/a |
| Returning visit, same session | `quill-tooltip-shown` already set | No pulse, no tooltip | n/a |
| `apps/api` unreachable/non-2xx | Underlying `/ask` call fails before any streaming starts | `/api/ask` route returns the existing plain JSON error body/status unchanged (502/400) — no stream attempted | Matches current route behavior exactly |

</intent-contract>

## Code Map

- `apps/web/src/components/ask-question.tsx` -- DELETE. Reusable pieces to carry into the quill panel: the `/api/ask` POST + `AnswerSchema.safeParse` validation pattern (lines 32–34, 79–94), the `CONFIDENCE_LABEL` idea (superseded by tier logic, not literally reused).
- `apps/web/specs/components/ask-question.spec.tsx` -- DELETE alongside the component.
- `apps/web/src/app/page.tsx` -- remove `AskQuestion` import (line 4) and its render block (lines 100–106) plus the "Ask the Archive" comment above it.
- `apps/web/src/app/layout.tsx` -- mount `<QuillWidget />` as a sibling of `{children}` inside `<body>` (currently just `<body>{children}</body>`, lines 13–17).
- `apps/web/src/app/api/ask/route.ts` -- rewrite the success path (currently a plain `Response.json(responseBody, ...)` at line 47) to relay via NDJSON streaming; the request-building/error paths (lines 17–44, unreachable/timeout handling, JSON-parse-failure 400) stay unchanged.
- `apps/web/src/lib/api-client.ts` -- reuse `resolveApiBaseUrl`/`ASK_FETCH_TIMEOUT_MS` unchanged; no edits.
- `libs/shared/src/lib/answer.ts` -- `Citation`/`Answer` types reused as-is (no schema changes); `confidence === 'high'` is the tier signal.
- `apps/api/src/app/ask/ask.controller.ts`, `ask.service.ts`, `verify-citations.ts` -- read-only reuse, unmodified. Confirms citation verification already completes before `AskService.ask` resolves, so the relay layer never needs its own verification step.
- `apps/web/src/app/papers/[paperNumber]/page.tsx` -- add a `highlight` searchParam (alongside existing `q`, lines 88–113); locate the matching paragraph inside `PaperReader` (lines 143–189) by a normalized-whitespace substring match against `paper.fullText`, give it `id="cited-passage"` and a highlight background using a new Parchment token.
- `apps/web/src/app/global.css` -- additive: new `@theme` entries for the Parchment & Manuscript tokens (namespaced, e.g. `--color-quill-*`) alongside the existing `--color-*` block (lines 9–37); do not touch existing vars.
- `docs/planning/ux-designs/ux-federalist_papers_ai_research_assistant-2026-08-29/DESIGN.md` -- source of the exact token values (colors block lines 5–23, `rounded` lines 55–58, component specs lines 71–98, dog-ear rationale line 156).
- New: `apps/web/src/lib/ask-stream.ts` -- shared `AskStreamEvent` union (`{type:'token', text} | {type:'done', answer, citations, confidence, insufficientEvidence}`) plus a word-chunking helper, imported by both the route (writer) and the quill panel (reader), so the two never drift on the wire format.
- New: `apps/web/src/components/quill/quill-widget.tsx`, `quill-launcher.tsx`, `quill-panel.tsx` -- see Design Notes for the split.
- `apps/web/specs/api/ask-route.spec.ts` -- rewrite for the new streaming success-path contract; keep the existing error-path assertions (unreachable/timeout/400) as-is since those code paths don't change.
- `apps/web/specs/papers/paper-number/page.spec.tsx` -- extend with `highlight` searchParam cases.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/lib/ask-stream.ts` -- add `AskStreamEvent` type + word-chunking/serialization helpers -- single source of truth for the wire format between writer and reader.
- `apps/web/src/app/api/ask/route.ts` -- on a 2xx apps/api response, parse the `Answer`; if `confidence === 'high'`, stream `token` events (word chunks, small artificial delay per DESIGN.md's "measured, readable pace") then one `done` event; otherwise write a single `done` event immediately. Non-2xx/unreachable/malformed-JSON paths keep returning the current plain JSON error response.
- `apps/web/src/app/global.css` -- add the Parchment & Manuscript `@theme` vars (`surface-panel`, `surface-user-bubble`, `surface-highlight`, `ink-primary`, `ink-secondary`, `ink-muted`, `accent` (oxblood `#8a1f1f`), `accent-gold` (`#c9a227`), `launcher-fill` (`#2f2418`)) plus the dog-ear radius pattern (`10px 10px 4px 10px`) as a reusable utility/class.
- `apps/web/src/components/quill/quill-launcher.tsx` -- 56px circular button, launcher-fill background, gold idle halo, first-session pulse + auto-tooltip driven by a `sessionStorage` flag (`quill-tooltip-shown`), ≥44px tap target, keyboard-activatable (Enter/Space via native `<button>`).
- `apps/web/src/components/quill/quill-panel.tsx` -- panel chrome (dog-eared shape, header band, close/collapse control), question input with focus-on-open, message list (question bubbles right/oxblood-accented, answer bubbles left/paper-white), streaming fetch of `/api/ask` reading `response.body` via `ask-stream.ts`'s parser, `aria-live="polite"` on the answer bubble, trailing cursor + "streaming…" caption while `status === 'streaming'`, send control `disabled` while streaming, inline "Connection lost — try asking again" state on a stream-ended-without-`done` condition, citation links (`<Link href="/papers/{n}?highlight=...#cited-passage">`, accessible name including the paper number) that close the panel (call back up to `quill-widget.tsx`) on click without clearing message state.
- `apps/web/src/components/quill/quill-widget.tsx` -- owns `isOpen` state and the message list (lifted so it survives panel close/reopen and Reader navigation); renders `QuillLauncher`/`QuillPanel`; responsive breakpoint (340px popup `≥ md`, full-screen sheet `< md`) per DESIGN.md.
- `apps/web/src/app/layout.tsx` -- render `<QuillWidget />` inside `<body>`, after `{children}`.
- `apps/web/src/app/page.tsx` -- delete the `AskQuestion` import and render block.
- Delete `apps/web/src/components/ask-question.tsx` and `apps/web/specs/components/ask-question.spec.tsx`.
- `apps/web/src/app/papers/[paperNumber]/page.tsx` -- add `highlight` to the `searchParams` type; inside `PaperReader`, normalize-and-match `highlight` against each paragraph, tag the match with `id="cited-passage"` and a highlight-token background class.
- `apps/web/specs/api/ask-route.spec.ts` -- rewrite success-path tests for the NDJSON contract (confident-tier token+done sequence; clarify/refuse done-only); keep error-path tests.
- New specs under `apps/web/specs/components/quill/` covering: first-visit pulse/tooltip vs. returning-visit silence; panel open moves focus to the input; confident-tier token-by-token render + cursor + `aria-live`; clarify/refuse instant render with no cursor; citation link accessible name/href and panel-collapse-on-click; connection-drop inline error + send re-enable; disabled send while streaming (double-submit guard).
- `apps/web/specs/papers/paper-number/page.spec.tsx` -- add cases for a matching `highlight` param (paragraph gets `id="cited-passage"` + highlight class) and a non-matching/absent one (no highlight applied, page renders normally).

**Acceptance Criteria:**
- Given any page, when it loads, then a 56px quill launcher renders bottom-right, collapsed by default, styled with the Parchment & Manuscript tokens (not default/shadcn styling).
- Given a first-time visit this session, when the page loads, then the launcher pulses once and a tooltip auto-opens reading "Ask me about the Federalist Papers →", then both are suppressed for the rest of the session; a returning visit in the same session shows neither.
- Given the launcher is collapsed, when clicked/tapped or reached via Tab+Enter/Space, then the panel opens (340px popup `≥ md` / full-screen `< md`) with focus moved into the question input.
- Given the panel is open, when a question is submitted, then a confident-tier answer streams token-by-token with a trailing cursor and "streaming…" caption, and a clarify/refuse response renders instantly with no cursor.
- Given a confident-tier answer has finished streaming, when citations attach, then each is a real, keyboard-accessible link whose accessible name includes the paper number, and no citation appears before the underlying response's server-side verification has completed.
- Given a citation link, when clicked, then the page navigates (client-side) to that paper's Reader, scrolls to/highlights the quoted passage, and the panel collapses to the launcher without clearing the conversation.
- Given the launcher/panel, then both are fully keyboard-operable, tap targets are ≥44px, and the streaming answer bubble uses `aria-live="polite"`.
- Given an answer is streaming, when the stream ends without a completion event (connection drop), then the partial text stays visible with the quiet inline error state, no auto-retry, and the send control re-enables.
- Given a response is streaming, then the send control is disabled, preventing a duplicate in-flight request from a double click/tap.

## Spec Change Log

- jsdom (via `jest-environment-jsdom` 30) does not provide `TextEncoder`/`TextDecoder`/`ReadableStream` on its global scope -- a known jsdom gap, not something Next's jest preset patches. `quill-panel.tsx` calls real `new TextDecoder()` (needed in real browsers regardless), so component specs under `apps/web/specs/components/quill/` polyfill `TextEncoder`/`TextDecoder` from `node:util` at module load (`ask-stream-test-helpers.ts`) and mock the streaming fetch response with a hand-rolled `{ getReader() }` object rather than a real `ReadableStream` instance (also absent from jsdom) -- `quill-panel.tsx` only ever calls `.getReader().read()`, so a plain object satisfying that shape is sufficient. `ask-route.spec.ts` needed no such polyfill: it already runs under `@jest-environment node`, where all three are native globals.
- DESIGN.md's chat-panel prose ("bottom-left ... tight corner") and its own numeric token (`radius: '10px 10px 4px 10px'`, i.e. `top-left top-right bottom-right bottom-left` = the *bottom-right* corner is the 4px tight one) disagree with each other. Resolved by trusting the numeric token literally (as the Code Map instructs) over the prose: the panel docks bottom-right, right next to the launcher, so a tight bottom-right corner "pointing down toward the launcher" is the geometrically sensible reading anyway.
- The mocked streaming reader in component tests resolves each `read()` after a real `setTimeout(0)` tick (not an immediately-resolved promise) -- otherwise the whole token loop settles within one microtask flush and React never commits an observable "mid-stream" render, making the cursor/`aria-live`/partial-text assertions unTestable.

## Review Triage Log

### 2026-09-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7 (high 0, medium 3, low 4)
- defer: 3 (high 0, medium 1, low 2)
- reject: 12 (high 0, medium 0, low 12)
- addressed_findings:
  - `medium` `patch` Server-side stream had no `cancel()` handler and the client fetch had no `AbortController` -- a collapsed/navigated-away panel left the server-side per-word delay loop running with nothing consuming it, and a late `enqueue` on an already-closed controller could throw. Fixed by wiring an `AbortController` client-side (aborted on unmount/collapse) and a `cancel()` handler server-side that stops the word loop.
  - `medium` `patch` The double-submit "disabled while streaming" guard lived in `QuillPanel`'s own local state, which unmounts/resets whenever `QuillWidget` collapses the panel -- collapsing and reopening mid-stream silently defeated the guard. Fixed by deriving the streaming flag from the lifted `messages` state in `QuillWidget` (last answer message's `status === 'streaming'`), which survives collapse/reopen.
  - `medium` `patch` `quill-launcher.tsx`'s `sessionStorage` read/write was unguarded -- throws in Safari private-mode/storage-disabled contexts would break the launcher's first render. Fixed with a try/catch that defaults to showing the tooltip when storage access fails.
  - `low` `patch` `chunkIntoWords`' regex dropped any leading whitespace in the answer text, contradicting its own docstring's exact-reproduction claim. Fixed the regex to retain a leading-whitespace-only chunk when present.
  - `low` `patch` `ask-route.spec.ts` and `quill-widget.spec.tsx` each hand-rolled the same NDJSON-decoding loop. Deduplicated into the shared `ask-stream-test-helpers.ts` and imported by both.
  - `low` `patch` The "token events arrive before done" assertion in `ask-route.spec.ts` only checked event counts/last-index, not that no token follows the done event positionally. Strengthened the assertion.
  - `low` `patch` Added a code comment on the `confidence === 'high'` streaming branch in `route.ts` noting that `'medium'` is currently unreachable per `AskService`'s tier logic (matches the invariant already documented in `libs/shared/src/lib/answer.ts`), so the condition isn't mistaken for an oversight.

## Design Notes

**Resolving the epic's inaccurate implementation notes (no human input needed — investigation, not ambiguity):**
- The epic's "reuse `PaperReader` and `/api/papers/[paperNumber]` as-is" doesn't match the code: there's no exported `PaperReader` component and no `/api/papers/[paperNumber]` route (`PaperReaderPage` fetches server-side directly). Resolution: don't extract/export anything or build a new route — the quill panel only *links* to the existing Reader page (a normal navigation), which already fetches its own data; `PaperReaderPage` just gains a `highlight` searchParam.
- The epic's "delete `AskQuestion`'s private `selectedCitation`/`paperState` state machine" describes something that was never built (`AskQuestion` has only a simple `AskState` union, no citation-selection or paper-state fields) — Story 3.3 (citation click-through) was never implemented. Resolution: this story is where citation-click navigation is actually built for the first time, not a migration of existing logic.
- "Streaming" cannot mean real token-level LLM streaming without changing `AskService`/`AIProvider` (it calls `generateStructuredOutput` for one complete, schema-validated JSON result) — and the epic context explicitly scopes this epic as "not a retrieval or verification redesign." Resolution: apps/api's `/ask` stays untouched; apps/web's own `/api/ask` route resolves the full answer first (verification already happened), then relays it to the browser in chunks. This still satisfies every AC (token-by-token reveal, trailing cursor, mid-stream connection-drop handling, citations attaching only post-verification) because verification already happened before the relay begins.
- "Collapses back to the launcher without clearing the conversation" on a citation click, without inventing Story 5.2's persistence early: mount `<QuillWidget />` in the root layout so it's a layout-level component that Next.js keeps mounted across `<Link>`-driven client-side navigations — its React state (open/closed + messages) simply survives, no storage needed. This only holds if citation links use `<Link>`, not a hard `<a href>`.

**NDJSON wire format** (not literal SSE/`EventSource` — this is a `POST` with a body, which `EventSource` can't do): each line is one JSON object, newline-delimited. Confident tier: N `{"type":"token","text":"word "}` lines, then one `{"type":"done","answer":"...","citations":[...],"confidence":"high","insufficientEvidence":false}`. Clarify/refuse: just the one `done` line. The client reads `response.body` via `getReader()`, splits on `\n`, and if the stream closes/errors before a `done` line arrives, treats it as a dropped connection.

## Verification

**Commands:**
- `npx nx test web` -- expected: all specs pass, including new/rewritten quill, ask-route, and paper-reader-page specs.
- `npx nx lint web` -- expected: no new lint errors.
- `npx nx build web` -- expected: production build succeeds (new client components, layout change).

**Manual checks (if no CLI):**
- Load the app, confirm the launcher pulse/tooltip appears once per browser session (check `sessionStorage`), ask a question, watch it stream, click a citation, confirm the Reader scrolls to/highlights the passage and the panel is collapsed with the conversation still present in `sessionStorage`-free React state.

## Auto Run Result

**Summary:** Replaced the homepage-only `AskQuestion` component with a floating quill launcher + popup panel mounted at the root layout, available on every page. The panel streams confident-tier answers token-by-token via a new NDJSON relay layered on top of the existing, unmodified `apps/api` `/ask` endpoint, renders clarify/refuse answers instantly, and citation links navigate (client-side) to the Paper Reader with the cited passage highlighted/scrolled-to, collapsing the panel without losing the conversation.

**Files changed:**
- `apps/web/src/lib/ask-stream.ts` (new) -- shared NDJSON `AskStreamEvent` type + chunking/serialize/parse helpers used by both the route (writer) and the panel (reader).
- `apps/web/src/app/api/ask/route.ts` -- success path now relays the already-verified `Answer` as NDJSON (word tokens + one `done` event for confident tier; a single `done` event for clarify/refuse); adds a `cancel()` handler so an aborted client stops the server-side word loop; error paths unchanged.
- `apps/web/src/app/global.css` -- additive Parchment & Manuscript `--color-quill-*` tokens, dog-ear/bubble shape utilities, one-time pulse keyframes.
- `apps/web/src/app/layout.tsx` -- mounts `<QuillWidget />` as a sibling of `{children}`.
- `apps/web/src/app/page.tsx` -- removed `AskQuestion` import/render.
- `apps/web/src/app/papers/[paperNumber]/page.tsx` -- added a `highlight` searchParam; the matching paragraph (whitespace-normalized substring match) gets `id="cited-passage"` + a highlight class.
- `apps/web/src/components/quill/quill-widget.tsx`, `quill-launcher.tsx`, `quill-panel.tsx` (new) -- launcher (first-session pulse/tooltip via guarded `sessionStorage`), panel (streaming fetch with `AbortController`, message list, citation links, connection-lost handling, double-submit guard derived from lifted message state).
- `apps/web/src/components/ask-question.tsx` -- deleted, along with `apps/web/specs/components/ask-question.spec.tsx`.
- `apps/web/specs/api/ask-route.spec.ts`, `apps/web/specs/papers/paper-number/page.spec.tsx` -- rewritten/extended for the streaming contract and highlight behavior.
- `apps/web/specs/components/quill/quill-launcher.spec.tsx`, `quill-widget.spec.tsx`, `ask-stream-test-helpers.ts` (new).

**Review findings breakdown:**
- Patches applied: 7 (high 0, medium 3, low 4) -- stream cancellation/`AbortController` wiring, double-submit guard surviving panel collapse/reopen, guarded `sessionStorage` access, `chunkIntoWords` leading-whitespace fix, deduplicated NDJSON test helper, strengthened token/done ordering assertion, clarifying comment on the unreachable `medium`-confidence branch.
- Deferred: 3 (medium 1, low 2) -- no focus trap/Escape-to-close/focus-return on the panel; `parseAskStreamEventLine` doesn't validate `done` event field shapes; no dedicated unit spec for `ask-stream.ts`'s helpers' malformed-input edge cases. See frontmatter `deferred`.
- Rejected: 12 -- including the `EXAMPLE_PROMPTS` "regression" (explicitly out of scope per this spec's Never section), a `confidence: 'medium'` streaming-ambiguity "bug" (unreachable per `AskService`'s tier logic, addressed via comment instead), late-event-after-done mutation risk (unreachable given the server's own sequential single-writer stream), unbounded citation-URL length, absence of dark-mode tokens (consistent with the rest of the app, not a regression), and several jsdom-test-environment limitations (viewport breakpoints, real Enter/Space keyboard simulation, computed tap-target measurement, hash-based scroll) that are systemic to this codebase's existing test conventions, not new gaps introduced by this story.

**Follow-up review recommendation:** `true` -- computed from this pass's patch findings only (3 medium + 4 low): `3 × 3 + 1 × 4 = 13 ≥ 5`.

**Verification performed:** `npx nx test web` (74/74 passing, 7 suites), `npx nx lint web` (0 errors, 1 pre-existing unrelated warning in `api/hello/route.ts`), `npx nx build web` (succeeds) -- all re-run and confirmed green after the patch pass. All 9 I/O & Edge-Case Matrix rows are covered by at least one passing test.

**Residual risks:** The three deferred items above (panel focus-trap/Escape/focus-return polish; unvalidated `done`-event shape in the wire-format parser; missing direct unit spec for `ask-stream.ts` helpers) are tracked in frontmatter `deferred` for future attention, not blocking this story's acceptance criteria.
