---
title: 'Thread recent conversation history into follow-up questions'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 0
context: []
baseline_revision: '11e618d08c69473e923c91f680db52f7f4f760bb'
followup_review_recommended: true
deferred:
  - summary: >-
      Individual history entries have no length/size cap -- HISTORY_MAX_TURNS bounds turn count,
      not per-turn or total size.
    evidence: |-
      isValidHistoryEntry only checks that question/answer are strings, any length. A client
      sending a small number of very large turns bypasses the turn-count cap and can still bloat
      prompt size/cost or trigger context_length_exceeded on effectively every request.
    location: >-
      apps/api/src/app/ask/ask.controller.ts (isValidHistoryEntry)
    severity: low
  - summary: >-
      The context_length_exceeded detection regex is broad and matches on raw error-message
      wording with no anchoring to a specific provider error shape.
    evidence: |-
      isContextLengthExceededMessage (gemini.provider.ts, openrouter.provider.ts) matches /context
      length|context window|token limit|maximum.*tokens|context_length_exceeded/i against any
      caught error's message. Checked live: 429/503/5xx are classified before this check runs, so
      a per-minute-rate-limit message wouldn't reach it in practice -- but an unanticipated 400
      from either provider that happens to mention "token limit" in an unrelated sense would still
      be misclassified as context_length_exceeded rather than client_error.
    location: >-
      libs/ai/src/lib/providers/gemini.provider.ts (isContextLengthExceededMessage), openrouter.provider.ts (same)
    severity: low
  - summary: >-
      No proactive warning as a conversation approaches the context limit -- the only handling is
      reactive (fail once, sometimes twice via the one allowed retry, then show
      CONTEXT_LENGTH_EXCEEDED_MESSAGE).
    evidence: |-
      Deliberate scope choice recorded in this story's Design Notes/rollback plan (reactive safety
      net was the agreed design, not a proactive soft-cap warning) -- noted here so it's visible as
      a considered tradeoff, not an oversight, if session length in practice makes this feel
      abrupt.
    location: >-
      apps/api/src/app/ask/ask.service.ts (CONTEXT_LENGTH_EXCEEDED_MESSAGE)
    severity: low
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every `POST /api/ask` call is answered from a completely blank slate — `AskController` only ever reads `question` and `currentPaper` from the request body (`ask.controller.ts:8-21`), and `AskService.ask(question, currentPaper)` has no history parameter at all. The quill widget does store the conversation in `sessionStorage` (`CHAT_HISTORY_SESSION_KEY`, `quill-widget.tsx`), but purely so the UI can re-render past messages on reopen/reload — it is never sent back to the API. Confirmed live (2026-09-05): asking "Can you compare and contrast these two papers?" as a follow-up to a turn that had just identified No. 6 and No. 8 as similar produced an answer comparing No. 1 and No. 8 instead — the backend had no idea "these two papers" meant 6 and 8, so retrieval semantically matched the raw question text alone and landed on the wrong papers. A follow-up clarifying "I meant papers 6 and 8" still failed, since the backend also has no memory of what its own prior (wrong) answer said, so it cannot actually compare anything using that turn's content.

**Approach:** The quill panel already holds the full conversation in React state before every new question is sent (`quill-panel.tsx`'s `messages`). Send the *entire* conversation history (all prior `done` question/answer pairs) in the `POST /api/ask` request body — the same pattern every hosted chat LLM product uses (see below), and simpler code than a capped window. Thread it through `AskController`/`AskService` into two places: (1) the retrieval query text, built from only the immediately preceding turn (not the full history — see Boundaries, this is about embedding-query focus, not cost), and (2) the generation prompt, as a "CONVERSATION SO FAR" block the model may use to resolve references — but never as a new source of citable evidence (every citation must still trace to the current turn's freshly retrieved chunks, exactly as today).

**Decided 2026-09-05 (product discussion):** send the full history first and see how it behaves in practice; keep a `HISTORY_MAX_TURNS` cap implemented (not deleted) as a one-line rollback, not the default. If full history turns out to cause problems in practice — rising latency/cost as sessions get long, or `context_length_exceeded` errors (see the safety addition below) becoming common — the fallback is flipping `HISTORY_MAX_TURNS` from `null` (no cap) to `3`, not re-architecting anything. See Design Notes.

**Why this does not violate NFR10:** NFR10 (`docs/planning/epics.md:47`) reads "each chat message is a fully independent, stateless request to the ask endpoint — no server-side conversational memory." That constrains the *server* from persisting or retaining anything between requests — it does not forbid a single request from carrying richer input. History here is supplied by the client on every call (still `sessionStorage`-only persistence, unchanged) and is used only to build that one request's retrieval query and prompt; the server stores nothing afterward, keeps no session identifier, and forgets it the instant the response is sent. This is additive to the same statelessness NFR10 requires, not a violation of it. This is also the standard architecture for every hosted chat LLM API (OpenAI/Anthropic/Gemini/Claude Code itself): the model has no memory between calls either, so "conversation" is always the caller resending prior turns on every request, typically the *entire* thread up to the model's real context window (Gemini's is over 1M tokens) — products only start trimming/summarizing once actually approaching that real limit, not at some small arbitrary count. This story follows that same standard pattern at one layer further out (browser to apps/api).

**Two safety additions (product ask, 2026-09-05), independent of the history-threading logic above:**
1. **"Clear chat" control.** No such affordance exists today (checked `quill-panel.tsx`/`quill-widget.tsx`) — the only way to reset a session is closing the tab. Add a visible control in the quill panel that clears both the in-memory `messages` state and the `CHAT_HISTORY_SESSION_KEY` `sessionStorage` entry.
2. **Honest messaging for a context-length failure.** Today's `CLIENT_ERROR_MESSAGE` (`ask.service.ts:69-70`) reads "not something your question caused" for *every* non-429 4xx — which would be actively wrong for a context-length-exceeded response, since a too-long conversation is exactly something the user's session caused. Add a distinct classification for this one case (detected by message content, since providers return a plain 400 with no dedicated status for it) with its own message pointing the user at the new "Clear chat" control. Because history is *not* capped by default (see above), this is the primary safety net for an unusually long session, not a rare defensive edge case.

## Boundaries & Constraints

**Always:**
- The `history` field on the request body is optional; its absence (older client, malformed value) behaves exactly as today — no regression to the current no-history behavior.
- Only `role: 'answer'` turns with `status: 'done'` (paired with their preceding `role: 'question'` turn) ever populate `history` — a `streaming` or `connection-lost` answer's text may be incomplete or absent and must never be sent as if it were a finished turn.
- `history` sent to the backend and rendered into the generation prompt is, by default, the *entire* prior conversation (all `done` question/answer pairs) — `HISTORY_MAX_TURNS` is implemented as a named constant defaulting to `null` (no cap), not deleted, specifically so it can be flipped to a number (e.g. `3`) as a one-line rollback if full history proves problematic in practice, without re-implementing the capping logic from scratch.
- The generation prompt's "CONVERSATION SO FAR" block is clearly separated from `EVIDENCE:` and the system instruction still states every citation's `chunkId` must come from the evidence supplied for *this* call — history is context for understanding the question, never a citable source itself.
- The retrieval query augmentation uses only the single immediately preceding turn (last question + last answer text, concatenated with the new question) — the turn most likely to hold the antecedent for "these", "that paper", "I meant X" — not the full capped history (keeps the embedding call's input focused rather than diluted by older, less relevant turns).
- `AskController` validates `history` defensively the same way it already treats `paperNumber`/`paperTitle`: a malformed entry (missing/non-string `question` or `answer`, non-array `history`) degrades to "drop the malformed entry" or "treat the whole field as absent" — never a 400. Malformed history is client-side data, not end-user input, but must never crash or reject the request either way.
- Existing single-turn behavior (no `history` sent, or an empty conversation) is byte-for-byte unchanged — this is purely additive.

**Never:**
- Do not persist `history` anywhere server-side (no DB table, no in-memory session map, no log field beyond what's already logged) — NFR10 still applies to everything after the response is sent.
- Do not let history content become a citable source — the model must never emit a citation whose `chunkId` only appeared in a *previous* turn's evidence, not the current one; `verifyCitations`'s existing set-membership check (against only the current call's retrieved chunks) already enforces this without changes, but the prompt wording must not undermine it by implying history is "more evidence."
- Do not change `retrieveRelevantChunks`'s signature or SQL — only the query *string* passed into it changes (built by a new small helper), the function itself stays exactly as it is.
- Do not touch citation verification, confidence tiering, or the streaming/NDJSON layer (`apps/web/src/app/api/ask/route.ts`) — this story only changes what goes *into* one `/api/ask` call, never how its response is produced or streamed back.
- "Clear chat" resets both `messages` state and the `sessionStorage` key in one action — never one without the other (a UI reset that leaves stale data in `sessionStorage` would silently reappear on the next reload).
- The context-length-exceeded classification is additive to the existing `ProviderFailureKind` set (`libs/ai/src/lib/ai-provider.interface.ts`) — every existing kind's behavior/message is unchanged; this only adds a new kind plus detection for it in both `gemini.provider.ts`'s `classifyFetchError` and `openrouter.provider.ts`'s `classifyOpenRouterError`.
- The new message must not repeat "not something your question caused" (today's `CLIENT_ERROR_MESSAGE` wording) — this failure mode is the opposite: it's specifically caused by how long the conversation has gotten.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No history (today's behavior) | `history` absent from request body | Retrieval query = raw question; prompt has no "CONVERSATION SO FAR" block | N/A — unchanged from current behavior |
| First question in a session | `messages` state has no prior turns when the panel builds the request | `history: []` or field omitted | Same as "no history" |
| Normal follow-up | 1+ prior `done` question/answer pairs in `messages` | Retrieval query includes the immediately preceding turn's text; prompt includes the full prior conversation (`HISTORY_MAX_TURNS` unset/`null`) | N/A |
| Follow-up right after a streaming/connection-lost answer | The most recent answer turn is `status: 'streaming'` or `'connection-lost'` | That turn is excluded from `history` sent to the backend | N/A — falls back to whatever earlier `done` turns exist, or no history |
| Malformed `history` entry | An entry missing `question`/`answer`, or non-string values | That entry is dropped | Never a 400; remaining valid entries (if any) still used |
| `history` is not an array at all | e.g. a string or object | Treated as if `history` were absent | Never a 400 |
| `HISTORY_MAX_TURNS` set to a number (rollback path) | Conversation has grown past the configured cap | Only the most recent `HISTORY_MAX_TURNS` are sent/used | N/A — exercised by a test even though the shipped default is `null`, so the rollback path is proven to work before it's ever needed |
| Model tries to cite from a history-only chunk | N/A (LLM behavior) | `verifyCitations` still rejects it (chunkId not in this call's retrieved set), same retry-then-refuse path as today | Unchanged existing behavior — no new code path, just confirms the existing check still covers this |
| User clicks "Clear chat" | Any conversation state, including mid-stream | `messages` reset to `[]`, `sessionStorage[CHAT_HISTORY_SESSION_KEY]` cleared | N/A |
| Provider rejects for context length | A 400 whose body indicates the input/context exceeded the model's limit | `ProviderFailureKind: 'context_length_exceeded'`; user sees an honest message pointing at "Clear chat", not the generic "developer needs to look at this" wording | Distinguished from other 4xx via message-content detection (no dedicated status code exists for this) |

</frozen-after-approval>

## Code Map

- `apps/web/src/components/quill/quill-panel.tsx` — before the `fetch('/api/ask', ...)` call, build a `history` array from all prior `done`-status question/answer pairs in `messages` (oldest first), include it in the JSON body when non-empty.
- `apps/api/src/app/ask/ask.controller.ts` — extend `AskRequestBody` with an optional `history?: unknown`; validate/coerce into a typed `Array<{ question: string; answer: string }>` (drop malformed entries, degrade whole field to absent on non-array), apply `HISTORY_MAX_TURNS` (constant, default `null` = no cap) if set, pass to `AskService.ask`.
- `apps/api/src/app/ask/ask.service.ts` — `ask()` gains a `history` parameter; builds the retrieval query via a new small helper using the immediately preceding turn + the new question, and passes the (uncapped by default) history array through to `buildAnswerPrompt`.
- `apps/api/src/app/ask/answer-prompt.ts` — `buildAnswerPrompt` gains a `history` parameter; renders a "CONVERSATION SO FAR" block (question/answer pairs, oldest first) positioned before `EVIDENCE:`, with wording that makes clear it's context only, never a citation source. New small helper (same file or `retrieval` call site in `ask.service.ts`) builds the retrieval query string from the immediately preceding turn + current question.
- Test files: `ask.controller` tests (new or existing `ask.http.spec.ts`), `ask.service.spec.ts`, `answer-prompt` tests (if any exist, else add), and a `quill-panel` test covering the request-body shape sent for a follow-up question.
- `apps/web/src/components/quill/quill-panel.tsx` (or `quill-widget.tsx`, wherever `CHAT_HISTORY_SESSION_KEY` is written) — add a "Clear chat" control: resets `messages` to `[]` and removes/clears the `sessionStorage` entry in one handler.
- `libs/ai/src/lib/ai-provider.interface.ts` — add `'context_length_exceeded'` to `ProviderFailureKind`.
- `libs/ai/src/lib/providers/gemini.provider.ts`, `libs/ai/src/lib/providers/openrouter.provider.ts` — detect a context-length-exceeded 400 (message-content match, e.g. `/context length|token.*limit|maximum.*tokens/i` — confirm exact wording against each provider's real error text during implementation) in `classifyFetchError`/`classifyOpenRouterError`, returning the new kind ahead of the generic `client_error` fallback.
- `apps/api/src/app/ask/ask.service.ts` — new `CONTEXT_LENGTH_EXCEEDED_MESSAGE` constant (references "Clear chat"), wired into `messageForFailureKind`'s existing kind→message mapping.

## Tasks & Acceptance

**Execution:**
- [x] `apps/api/src/app/ask/ask.controller.ts` -- add optional `history` to `AskRequestBody`, validate/cap/coerce
- [x] `apps/api/src/app/ask/ask.service.ts` -- thread `history` through to retrieval-query construction and `buildAnswerPrompt`; add `CONTEXT_LENGTH_EXCEEDED_MESSAGE` to `messageForFailureKind`
- [x] `apps/api/src/app/ask/answer-prompt.ts` -- render "CONVERSATION SO FAR" block; add retrieval-query-builder helper
- [x] `apps/web/src/components/quill/quill-panel.tsx` -- build and send full `history` from `messages` on each ask
- [x] `apps/web/src/components/quill` (panel/widget) -- add a "Clear chat" control resetting both `messages` and `sessionStorage`
- [x] `libs/ai/src/lib/ai-provider.interface.ts` -- add `'context_length_exceeded'` to `ProviderFailureKind`
- [x] `libs/ai/src/lib/providers/gemini.provider.ts`, `openrouter.provider.ts` -- detect and classify the context-length-exceeded case
- [x] Update/add tests for every I/O matrix row
- [x] Run `nx run-many -t test --projects=ai,api,web` -- zero regressions

**Acceptance Criteria:**
- Given a conversation where the previous turn's answer identified "No. 6 and No. 8" as similar, when the user asks "Can you compare and contrast these two papers?", then the retrieval query and prompt both carry enough context that the answer addresses No. 6 and No. 8 specifically, not an unrelated paper.
- Given no prior conversation (first question, or `history` omitted/malformed), when `/api/ask` is called, then behavior is identical to today — no regression.
- Given the model attempts to cite a chunkId that only appeared in a previous turn's evidence, when `verifyCitations` runs, then it is still rejected exactly as it is today (confirms history doesn't create a new citation-bypass path).
- Given the user clicks "Clear chat", when the panel is reopened (even after a reload), then no prior conversation is restored.
- Given a provider response classified as `context_length_exceeded`, when the refuse outcome is built, then the message references clearing the chat and does not claim "not something your question caused."

## Design Notes

**Rollback plan, recorded up front (2026-09-05):** the shipped default sends the full conversation history on every call, matching how ChatGPT/Claude/Gemini's own chat products work (the model has no memory between calls regardless; "conversation" is always the caller resending prior turns). `HISTORY_MAX_TURNS` is implemented as a real constant (`null` by default) with working cap logic behind it, specifically so that if full history causes problems in practice (rising latency/cost as sessions get long, or the new `context_length_exceeded` message showing up often), the fix is changing one constant to `3` — not writing new code. Whoever picks this up later should check: has `context_length_exceeded` actually fired in production/local testing? Has latency visibly grown across a long session? If either is a real, observed problem (not just a theoretical one), flip the constant rather than re-deriving the capping logic.

## Verification

**Commands:**
- `nx run-many -t test --projects=ai,api,web` -- expect no regressions
- Manual: reproduce the exact failing sequence from this story's Problem statement (summarize No. 8 → "which paper is most similar" → "compare and contrast these two papers") and confirm the third answer addresses the correct pair.
- Manual: click "Clear chat", reload the page, confirm no prior conversation is restored.

## Suggested Review Order

**Retrieval query + prompt construction (the core fix)**

- `formatHistoryBlock`/`buildRetrievalQuery`/`buildAnswerPrompt`'s `history` param -- the immediately-preceding-turn-only retrieval query vs. the full-history prompt block distinction this story's Boundaries insist on.
  [`answer-prompt.ts:67`](../../apps/api/src/app/ask/answer-prompt.ts#L67), [`answer-prompt.ts:133`](../../apps/api/src/app/ask/answer-prompt.ts#L133)
- `ANSWER_SYSTEM_INSTRUCTION`'s added sentence on history never being a citation source.
  [`answer-prompt.ts:14`](../../apps/api/src/app/ask/answer-prompt.ts#L14)

**Orchestration (threading history through the tiers)**

- `AskService.ask`'s new `history` param, `buildRetrievalQuery` call site, and threading through `resolveOutcome`/`answerConfidently`/`retryOrFailSafe`/`tryGenerate`.
  [`ask.service.ts:291`](../../apps/api/src/app/ask/ask.service.ts#L291)
- `CONTEXT_LENGTH_EXCEEDED_MESSAGE` + its `messageForFailureKind`/`FAILURE_KIND_PRIORITY` wiring.
  [`ask.service.ts:82`](../../apps/api/src/app/ask/ask.service.ts#L82)

**Frontend (history building + Clear chat)**

- `buildHistory`'s adjacent-pair scan, including the post-review `!answer.insufficientEvidence` exclusion (see Review Triage Log).
  [`quill-panel.tsx:98`](../../apps/web/src/components/quill/quill-panel.tsx#L98)
- `handleClearChat` -- resets `messages` and `sessionStorage` in one action, abort-safe mid-stream.
  [`quill-panel.tsx:273`](../../apps/web/src/components/quill/quill-panel.tsx#L273)

## Auto Run Result

**Summary:** Threaded a bounded-by-default-to-unbounded (`HISTORY_MAX_TURNS = null`, rollback-ready) conversation history into both the retrieval embedding query (immediately preceding turn only) and the generation prompt (full history, as a "CONVERSATION SO FAR" block never treated as citable evidence). Added a "Clear chat" control (didn't exist before) and an honest `context_length_exceeded` classification/message distinct from the generic client-error wording. Post-review patch closed a self-reinforcing failure loop where refusal/error turns (including the new context-length message itself) were being fed back into history.

**Files changed:** `apps/api/src/app/ask/{ask.controller,ask.service,answer-prompt}.ts` (+specs), `libs/ai/src/lib/ai-provider.interface.ts`, `libs/ai/src/lib/providers/{gemini,openrouter}.provider.ts` (+specs), `apps/web/src/components/quill/quill-panel.tsx`, `apps/web/specs/components/quill/quill-widget.spec.tsx`.

**Review findings breakdown:** 1 patch applied (high severity — self-reinforcing context-length failure loop), 3 deferred (all low severity — per-turn size cap, context-length regex breadth, no proactive overflow warning), 12 rejected as non-issues after verification (see Review Triage Log for each refutation).

**Follow-up review recommendation:** `true` (one high-severity patch was applied this pass).

**Verification performed:** `nx run-many -t test,build,lint --projects=ai,api,web` — `ai` 3/3 suites (49/49 tests), `api` 17/17 suites (233/233 tests), `web` 9/9 suites (104/104 tests), build/lint clean. Matrix Test Audit: every I/O & Edge-Case Matrix row confirmed covered by a passing, real (non-mock-only) test before proceeding to review. Manual live reproduction of the original failing conversation sequence and manual "Clear chat" browser testing were not performed (require a live provider key / browser session) — flagged as residual risk below.

**Residual risks:** (1) manual end-to-end reproduction of the exact "No. 6/No. 8 compare and contrast" sequence against a live Gemini/OpenRouter call has not been run; (2) manual "Clear chat" verification in an actual browser has not been performed; (3) the three deferred items above (per-turn size cap, context-length regex breadth, no proactive overflow warning) remain open, low-severity, and not blocking.

## Review Triage Log

### 2026-09-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (high)
- defer: 3 (0 high, 0 medium, 3 low)
- reject: 12
- addressed_findings:
  - `[high]` `[patch]` `buildHistory()` included any `status: 'done'` answer turn in history regardless of outcome — a refuse/clarify/`context_length_exceeded` refusal got fed back into the next request's history as if it were a genuine answer, and the `context_length_exceeded` case specifically was self-reinforcing (the failed turn's own "conversation too long" text made the next request even longer, guaranteeing repeated failure with no path back except manually finding "Clear chat"). Confirmed independently by three review layers (blind-hunter, verification-gap, intent-alignment auditor). Fixed: `buildHistory` now also excludes any answer with `insufficientEvidence === true`, in addition to the existing streaming/connection-lost exclusion. New test added (`quill-widget.spec.tsx`) mirroring the existing connection-lost-exclusion test. Re-ran `nx run-many -t test,build,lint --projects=ai,api,web` twice fresh -- 49 (ai) + 233 (api) + 104 (web) = 386 tests pass, clean build/lint.

Reviewed and rejected as non-issues (verified, not merely dismissed):
- Blind Hunter's "`quill-widget.tsx` is never touched by this diff yet the diff depends on it" (importing `CHAT_HISTORY_SESSION_KEY`) -- refuted: that constant was already exported from `quill-widget.tsx` in Story 5.2, confirmed by reading the file; this diff only adds a new named import of an already-existing export, no changes to that file were needed.
- Edge Case Hunter's/Blind Hunter's "no test proving `FAILURE_KIND_PRIORITY`'s new top-position doesn't regress other pairwise combos" -- refuted: prepending one new entry to the front of an array cannot change the relative order of the existing six entries, so every pre-existing pairwise-priority test (from the OpenRouter-provider story) remains valid and unaffected by this insertion.
- Blind Hunter's "inconsistent validation approach vs. the rest of the codebase" (hand-rolled `coerceHistory` vs. Zod) -- refuted: `AskRequestBody`'s existing `paperNumber`/`paperTitle` fields in this same file are already hand-validated, not Zod-based; `history`'s validation matches the file's own existing convention, not a new inconsistency.
- Blind Hunter's "history content is unauthenticated/unverified client input threaded into the generation prompt" (prompt-injection risk) -- reviewed and judged not specific to this story: the existing `question` field already has identical exposure (raw user text straight into the prompt) with no additional mitigation; `history` doesn't introduce a new attack surface beyond what already exists.
- Blind Hunter's "no proactive UX signal as the conversation approaches the context limit" -- this is a deliberate, already-recorded scope choice (Design Notes: reactive safety net was the agreed design), not an oversight -- retained as a low-severity deferred note rather than a finding requiring action.
- Remaining Blind Hunter/Edge Case Hunter findings (per-turn size cap, embedding-query truncation ordering, `buildHistory`'s alternation-invariant assumption, sessionStorage quota under uncapped history, no request-body size guard, no structured citation carry-over) -- each either mirrors an existing, already-accepted codebase pattern, is structurally guaranteed elsewhere in the code (message pairs are only ever appended together, never individually), or is an explicit design tradeoff already recorded in this spec's Approach/Design Notes.

**Request validation (defensive coercion, never a 400)**

- `coerceHistory`/`isValidHistoryEntry`/`HISTORY_MAX_TURNS` in the controller -- the malformed-entry-drops-not-whole-field and null-vs-numeric-cap behavior.
  [`ask.controller.ts:22`](../../apps/api/src/app/ask/ask.controller.ts#L22)

**Provider-layer classification (new failure kind)**

- `ProviderFailureKind`'s new `'context_length_exceeded'` member.
  [`ai-provider.interface.ts:24`](../../libs/ai/src/lib/ai-provider.interface.ts#L24)
- `isContextLengthExceededMessage` + its call site ahead of the generic 4xx fallback, in both providers.
  [`gemini.provider.ts:71`](../../libs/ai/src/lib/providers/gemini.provider.ts#L71), [`openrouter.provider.ts:308`](../../libs/ai/src/lib/providers/openrouter.provider.ts#L308)

**Client (sending history + Clear chat)**

- `buildHistory`'s adjacent-pair scan (excludes non-`done` answers) and its call site in `handleSubmit`.
  [`quill-panel.tsx:98`](../../apps/web/src/components/quill/quill-panel.tsx#L98)
- `handleClearChat` -- resets `messages` and `sessionStorage` together, safe mid-stream.
  [`quill-panel.tsx:273`](../../apps/web/src/components/quill/quill-panel.tsx#L273)
