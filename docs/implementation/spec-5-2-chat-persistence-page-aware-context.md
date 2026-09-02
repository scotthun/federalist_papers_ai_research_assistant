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

**Approach:** Persist the conversation to `sessionStorage` (write-through on settle, not on every streaming token) so it survives a reload within the same tab but never a new tab. Add a small React Context, populated by a tiny client component the Paper Reader page renders, so the layout-level quill widget learns which paper (if any) is currently being read; when present, show a removable context chip and thread that paper's number into the ask request as a retrieval filter using the retrieval library's existing, already-built `paperNumber` filter option — no new filtering path.

## Boundaries & Constraints

**Always:**
- Conversation persistence is `sessionStorage` only — no network/DB round trip, no `localStorage` (NFR8/NFR10). Cleared automatically on tab close; a genuinely new tab (not a duplicated/restored one — most browsers do copy `sessionStorage` when a tab is explicitly duplicated or a crashed session is restored, which is outside this AC's "closes the tab, reopens the app in a new tab" scenario) never inherits it — native `sessionStorage` scoping, no code needed for that half.
- Persistence writes are skipped while any message has `status: 'streaming'` (checked in the same effect that would otherwise write) — only the settled state (question added, or an answer reaching `done`/`connection-lost`) triggers a `sessionStorage` write. This avoids adding a write on every streamed token, which would compound the "streaming already feels a little rough" feedback from Story 5.1.
- On restoring from `sessionStorage` (initial mount only), any restored answer message still carrying `status: 'streaming'` is downgraded to `connection-lost` — a real reload has no fetch/reader left to resume it, so leaving it `streaming` would show a permanent cursor with nothing behind it.
- The paper-context chip's presence and the ask request's `paperNumber` filter are the same boolean, driven by the same piece of state — never two independently-tracked flags that could drift (the AC ties them 1:1: chip visible ⇔ filter applied).
- Dismissing the chip resets automatically the moment the *current paper* changes (including changing to "no paper" and back) — implemented as an effect keyed on the announced paper's `paperNumber`, not a value that persists across navigation. This is what makes "does not reappear while remaining on that same page" and "re-evaluates fresh" for a different paper (or the same paper revisited later) both true from one mechanism.
- `apps/api`'s `AskController`/`AskService` gain an *optional* `paperNumber` parameter threaded straight into `retrieveRelevantChunks`'s existing `RetrieveOptions.paperNumber` (`libs/retrieval/src/lib/retrieval.ts:29`) — that option, and its filter-before-`LIMIT` SQL behavior (CAP-2/NFR6), already exists and is already tested; nothing in `libs/retrieval` changes.
- A `paperNumber` in the request body that isn't a finite number is treated as absent (no filter, no error) — this field is client-controlled (our own quill panel), not end-user-typed, so a malformed value degrades to "search the whole archive" rather than a 400.

**Block If:** None identified.

**Never:**
- Do not persist conversation to `localStorage`, a cookie, or the backend — session-tab-scoped only (NFR10).
- Do not add a `ChatSession`/`ChatMessage` database table — explicit non-goal carried from Epic 5's context.
- Do not build a new client-fetchable `/api/papers/[paperNumber]` route to learn the paper's title — the Paper Reader page (a Server Component) already has the title; it's threaded to the widget via a small Context, not a second fetch.
- Do not show the context chip, or apply any `paperNumber` filter, on the Homepage or Browse Papers — those pages render nothing that announces a current paper, so the default (no) context applies automatically.
- Do not persist chip-dismissal across a page reload or new tab — it's ephemeral UI state for "while I keep looking at this specific paper," not part of the conversation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Reload mid-conversation | User has asked ≥1 question, then hard-reloads the same tab | Question/answer history reappears next time the panel is opened | n/a |
| New tab | User opens the app in a brand-new tab (not a reload) | No prior chat history — empty conversation | n/a |
| Reload mid-stream | Reload happens while an answer's `status` was `streaming` | Restored message shows `connection-lost`, not a stuck cursor | n/a |
| Open panel on a Paper Reader page | User opens the panel while viewing `/papers/{N}` | "📄 Federalist No. {N}" chip appears at the top of the message list, titled from that page's own data | n/a |
| Open panel on Homepage/Browse Papers | User opens the panel from `/` or a search results page | No chip; input placeholder alone signals archive-wide scope | n/a |
| Ask with chip present | Chip showing for paper N, user submits a question | `/api/ask` request body includes `paperNumber: N`; answer is filtered to that paper | n/a |
| Dismiss chip, then ask | User clicks the chip's ✕, then submits a question | Chip gone; request has no `paperNumber`; searches the whole archive | n/a |
| Dismiss chip, stay on same paper | Chip dismissed for paper N, user keeps browsing/asking on the same `/papers/N` | Chip does not reappear | n/a |
| Dismiss on N, navigate to M | Chip dismissed for paper N, user clicks a citation/link to a different paper M | Chip re-evaluates fresh and appears again for M | n/a |
| Navigate away and back to N | Chip dismissed for paper N, user goes to Browse Papers, then returns to paper N | Chip reappears (a fresh arrival at N, not a continuous "remaining on that page") | n/a |
| `paperNumber` malformed | Request body's `paperNumber` is present but not a finite number | Treated as absent — no filter applied, no 400 | Defensive coercion in `AskController`, not a validation error |

</intent-contract>

## Code Map

- `apps/web/src/components/quill/quill-widget.tsx` -- add: (1) lazy `useState` initializer reading `sessionStorage` (key `quill-chat-history`) for `messages`, sanitizing any `status: 'streaming'` message to `connection-lost`; (2) a write-through `useEffect` on `messages` that skips the write while `messages.some(m => m.role === 'answer' && m.status === 'streaming')`; (3) consume `usePaperContext()` (new); (4) own `chipDismissed` boolean state with a `useEffect` keyed on `currentPaper?.paperNumber` that resets it to `false` on every change; (5) compute `activePaperContext = chipDismissed ? null : currentPaper` and pass it (plus a dismiss callback) down to `QuillPanel`.
- `apps/web/src/components/quill/quill-launcher.tsx` -- read-only reference for the guarded-`sessionStorage`-access pattern (try/catch around `getItem`/`setItem`, lines 27-43) that the new persistence code should mirror. No edits.
- `apps/web/src/components/quill/quill-panel.tsx` -- add a `paperContext: { paperNumber: number; title: string } | null` prop and an `onDismissPaperContext: () => void` prop; render the chip (per DESIGN.md's "Context chip" component spec) above the message list when `paperContext` is non-null; include `paperNumber: paperContext.paperNumber` in the `/api/ask` POST body (line 157's `JSON.stringify({ question: trimmedQuestion })`) when present.
- `apps/web/src/app/api/ask/route.ts` -- **no change**: it already forwards the parsed request `body` verbatim to apps/api (`JSON.stringify(body)`), so an added `paperNumber` field passes through automatically.
- New: `apps/web/src/components/quill/paper-context.tsx` -- `PaperContext` (React Context, default `{ currentPaper: null, setCurrentPaper: noop }` so it's safe with no provider ancestor in tests), `PaperContextProvider` (holds `currentPaper` state), `usePaperContext()` hook.
- New: `apps/web/src/components/quill/announce-paper-context.tsx` -- `'use client'` component `AnnouncePaperContext({ paperNumber, title })`; on mount/paperNumber-or-title change calls `setCurrentPaper({ paperNumber, title })`, clears (`setCurrentPaper(null)`) on unmount. Kept as its own file because the Reader page itself is an async Server Component and can't carry a `'use client'` directive.
- `apps/web/src/app/layout.tsx` -- wrap `{children}` and `<QuillWidget />` together in the new `<PaperContextProvider>` (currently just renders them as plain siblings inside `<body>`, lines 16-21).
- `apps/web/src/app/papers/[paperNumber]/page.tsx` -- in `PaperReaderPage`'s success branch (line 152, alongside `<PaperReader paper={result.paper} highlight={highlight} />`), render `<AnnouncePaperContext paperNumber={result.paper.paperNumber} title={result.paper.title} />`.
- `apps/api/src/app/ask/ask.controller.ts` -- add `paperNumber?: unknown` to `AskRequestBody` (line 8-10); in `ask()` (line 33), coerce it (`typeof body?.paperNumber === 'number' && Number.isFinite(...)`, else `undefined`) and pass as a second argument: `this.askService.ask(trimmedQuestion, paperNumber)`.
- `apps/api/src/app/ask/ask.service.ts` -- `AskService.ask` (line 164) gains an optional `paperNumber?: number` second parameter, forwarded into the existing `retrieveRelevantChunks(..., { topK: TOP_K, paperNumber })` call (line 177-179).
- `libs/retrieval/src/lib/retrieval.ts` -- read-only reuse; `RetrieveOptions.paperNumber` (line 29) and its filter-before-`LIMIT` SQL already exist and are already tested by `libs/retrieval`'s own specs. No edits.
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
- `apps/web/src/components/quill/quill-panel.tsx` -- accept and render the context chip from the new props; include `paperNumber` in the ask request body when present -- keeps `QuillPanel` presentational (per Story 5.1's split) while still surfacing/using the new state.
- `apps/api/src/app/ask/ask.controller.ts` -- accept and coerce an optional `paperNumber`, pass to `AskService.ask` -- the request-validation boundary, same role it already plays for `question`.
- `apps/api/src/app/ask/ask.service.ts` -- thread `paperNumber` into the existing `retrieveRelevantChunks` options -- the one call site that already supports this filter.
- Unit-test every I/O Matrix row (see specs listed in Code Map).

**Acceptance Criteria:**
- Given an existing conversation in the current tab, when the user reloads or navigates by URL, then the chat history remains present next time the panel is opened, with no network/database round trip.
- Given the user closes the tab and reopens the app in a new tab, then no prior chat history is restored.
- Given the panel opened on a Paper Reader page, when it renders, then a removable "📄 Federalist No. {N}" context chip appears, pre-filled with that paper's title.
- Given the context chip is present, when a question is submitted, then the request includes that paper's `paperNumber` as a retrieval filter, reusing the existing filter-before-limit mechanism.
- Given the context chip is present, when the user clicks its ✕, then the chip is removed, the next question searches the whole archive, and the chip does not reappear while the user remains on that same Paper Reader page.
- Given the chip was removed while reading paper N, when the user navigates to a different Paper Reader (paper M), then the chip re-evaluates fresh and appears again for M.
- Given the panel is opened from the Homepage or Browse Papers, then no context chip appears.

## Spec Change Log

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
- Ask a question, reload the tab, reopen the panel, confirm the conversation is still there; open the app in a brand-new tab and confirm it's empty. Open the panel on a Paper Reader page, confirm the chip appears with the right title, dismiss it, ask a question, confirm (via network tab) no `paperNumber` was sent; navigate to a different paper via a citation and confirm the chip reappears.

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
