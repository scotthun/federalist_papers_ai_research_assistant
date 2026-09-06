---
title: 'Chat nice-to-haves: word-boundary citation truncation, citation arrival cue, Clear-chat discoverability'
type: 'polish'
created: '2026-09-06'
status: 'done'
context: []
baseline_revision: '23c983c'
followup_review_recommended: false
deferred:
  - summary: 'truncateCitationSnippet falls back to a hard cut (possibly mid-word) when the cut region has no space at all -- unavoidable for one long unbroken "word" longer than the cap, not fixed further here.'
    evidence: 'design tradeoff, not a bug -- documented in the function doc comment'
    location: 'apps/web/src/lib/citation-snippet.ts'
    severity: 'low'
---

## Intent

Three small, independent UX quality-of-life items from a UX pulse-check (2026-09-06), grouped
into one "nice to haves" story since none is urgent on its own:

1. **Word-boundary citation truncation**: `truncateCitationSnippet` previously hard-cut at exactly
   `maxLength`, sometimes landing mid-word (e.g. "...factio…") -- reads as sloppy in a
   screenshot/demo even though functionally harmless. Now backs up to the last word boundary.
2. **Citation arrival cue**: citations currently mount all at once the instant an answer reaches
   `done`, easy to miss below a long answer that's already stopped looking "active." A brief
   fade/slide-in CSS animation (`quill-citations-fade-in`, one iteration, matching the existing
   `quill-pulse-once` convention) gives that moment a visible cue.
3. **Clear-chat discoverability**: `CONTEXT_LENGTH_EXCEEDED_MESSAGE` is the one answer that tells
   the user exactly what to do ('use "Clear chat" to start a new conversation'), but that only
   worked if the user separately noticed and clicked the header's own "Clear chat" button. The
   phrase `"Clear chat"` inside any `done` answer's text is now itself a real clickable trigger for
   the same action.

## Boundaries & Constraints

**Always:**
- Word-boundary truncation only changes *where* the cut lands, never the existing length cap,
  ellipsis character, or the "return unchanged if already short enough" behavior.
- The citation fade-in is a one-shot mount animation (`1` iteration) -- never looping, never
  re-triggered by anything other than the citations list's own first mount.
- The inline "Clear chat" trigger matches on the literal phrase `"Clear chat"` (with its
  surrounding quote marks, exactly as apps/api's message renders it) inside a `done` message's
  text -- never applied to a `streaming` message (its text is still arriving token-by-token).
  Clicking it calls the exact same `handleClearChat` the header button already calls -- no second,
  divergent implementation of "clear the chat."

**Never:**
- Never falls back to fuzzy/approximate truncation (e.g. counting words instead of a character
  cap) -- still a character-length cap, just with a word-boundary-aware cut point.
- Never changes `CONTEXT_LENGTH_EXCEEDED_MESSAGE`'s actual wording in apps/api -- purely a web-side
  rendering change matched against whatever phrase already appears.

## I/O & Edge-Case Matrix

| Scenario | Expected Behavior |
|----------|-------------------|
| `quotedPassage` longer than the cap, with a space before the cap | Truncates at the last space, never mid-word |
| `quotedPassage` longer than the cap, no space anywhere in the cut region | Falls back to the previous hard cut (unavoidable) |
| `quotedPassage` at or under the cap | Unchanged, no ellipsis (pre-existing behavior, unaffected) |
| An answer reaches `done` with citations | The citations `<ul>` gets the `quill-citations-fade-in` class |
| An answer's text contains the literal phrase `"Clear chat"` | That phrase renders as a clickable button calling the same clear-chat action as the header control |
| An answer's text does not contain that phrase | Renders as plain text, unchanged from before |
| A `streaming` message's text happens to contain the phrase | Rendered as plain text, not a button (only `done` messages get the clickable treatment) |

## Code Map

- `apps/web/src/lib/citation-snippet.ts` -- `truncateCitationSnippet`'s word-boundary cut.
- `apps/web/src/app/global.css` -- `.quill-citations-fade-in` / `@keyframes quill-citations-fade-in`.
- `apps/web/src/components/quill/quill-panel.tsx` -- `renderAnswerText`, the citations `<ul>`'s new
  class, `AnswerBubble`'s new `onClearChat` prop.
- Tests: `apps/web/specs/lib/citation-snippet.spec.ts`, `apps/web/specs/components/quill/quill-widget.spec.tsx`.

## Verification

`npx nx run-many -t test,build,lint --projects=web --skip-nx-cache` -- all passing (44/44 relevant
tests, build/lint clean).
