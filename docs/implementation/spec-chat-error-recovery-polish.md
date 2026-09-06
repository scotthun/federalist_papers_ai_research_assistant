---
title: 'Chat error recovery polish: retry after connection lost, long-wait feedback'
type: 'polish'
created: '2026-09-06'
status: 'done'
context: []
baseline_revision: '23c983c'
followup_review_recommended: false
---

## Intent

Prompted by a live session (2026-09-06) where Gemini's free tier went from a hard 503 to simply
*slow* (single calls of 50-90+ seconds) -- one request eventually hit apps/web's own server-to-
server fetch timeout and surfaced as "Connection lost — try asking again." with no way to recover
except manually retyping the exact same question, and no indication while waiting that a request
was taking unusually long rather than just normally "thinking."

Two small, independent UX gaps, fixed together as one story since both touch the same answer
bubble:

1. **Retry**: a `connection-lost` answer message gets a "Retry" button that resends the *same*
   question in place (reusing the same message id, not appending a new question/answer pair) --
   removing the "do I need to retype this?" guesswork.
2. **Long-wait feedback**: the `streaming…` caption switches to "Still working — this is taking
   longer than usual…" once a response has been streaming for longer than
   `LONG_WAIT_NOTICE_DELAY_MS` (15s) -- a one-way flip, not a live countdown, since the actual
   remaining wait is unknowable up front.

## Boundaries & Constraints

**Always:**
- Retry resends the exact original question text (from the preceding `question` message), never
  whatever currently sits in the input field.
- Retry uses history built from only the turns strictly before the retried question -- identical
  to what the original attempt would have sent, never including the retried turn itself.
- Retry uses the *current* paper context at the moment Retry is clicked, not whatever was active
  when the question was first asked (same as a brand-new send always does).
- Retry is a no-op while any request is already in flight (mirrors `handleSubmit`'s own
  double-submit guard) -- the button is also visually `disabled` in that state, not just
  functionally blocked, so it never looks clickable without being clickable.
- The long-wait notice is purely a caption swap -- no change to `isStreaming`, no new message
  status, nothing that could affect `buildHistory`/persistence/citations.

**Never:**
- Retry never appends a new question bubble -- exactly one question bubble per turn, retried or
  not.
- The long-wait notice never appears before `LONG_WAIT_NOTICE_DELAY_MS` has elapsed, and never
  persists once the message leaves `streaming` (finalized or itself gone connection-lost).

## I/O & Edge-Case Matrix

| Scenario | Expected Behavior |
|----------|-------------------|
| Retry clicked on a `connection-lost` message | Same question resent in place; on success, message becomes `done` with the new answer/citations; question bubble count unchanged |
| Retry clicked while another request is in flight | No-op (button disabled); no second request sent |
| A message streams past 15s | Caption switches from "streaming…" to the long-wait notice |
| A message finishes before 15s | Long-wait notice never appears |
| A message streaming, then finalized before the timer fires | Timer's cleanup runs on unmount/status-change; no stray notice after finalization |

## Code Map

- `apps/web/src/components/quill/quill-panel.tsx` -- `sendAskRequest` (extracted, shared by
  `handleSubmit` and the new `handleRetry`), `resetToStreaming`, `handleRetry`, `AnswerBubble`'s
  Retry button and `isLongWait` timer, `LONG_WAIT_NOTICE_DELAY_MS`.
- `apps/web/specs/components/quill/quill-widget.spec.tsx` -- `Retry after connection lost` and
  `Long-wait streaming notice` describe blocks.

## Verification

`npx nx run-many -t test,build,lint --projects=web --skip-nx-cache` -- all passing (41/41 web
tests, build/lint clean).
