---
title: 'Fix: quill panel mispositioned when keyboard opens (visualViewport offsetTop)'
type: 'bugfix'
created: '2026-09-17'
status: 'done'
baseline_commit: '1acaa0905ac5a65a92882127989f1023c5aa218b'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The prior fix (`spec-mobile-keyboard-panel-clipping.md`) tracked `visualViewport.height`
but not `visualViewport.offsetTop`, and made the panel's positioning worse on a real iPhone: on
first open (input auto-focuses immediately, opening the keyboard right away), only the input bar
is visible near the top of the screen with the underlying page showing through — header and
messages effectively gone. Root cause (confirmed via research against MDN's Visual Viewport API
docs): when iOS scrolls the layout viewport to reveal the focused input, the visual viewport's
*origin* shifts down by `offsetTop` relative to the layout viewport; a `position: fixed` panel
anchored at a static `top: 0` doesn't track that shift, so it visually "scrolls away" underneath
the real visible area.

**Approach:** Extend the existing hook to also track `visualViewport.offsetTop`, and apply it as
the panel's `top` (not a static `0`) alongside the existing dynamic `height`. Additionally, per
product decision this session: stop auto-focusing the input on mobile open (switch to tap-to-focus)
— research confirms this is the dominant mobile-web chat convention specifically because it avoids
this entire class of keyboard-race bug; desktop behavior (auto-focus stays) is unaffected.

## Boundaries & Constraints

**Always:**
- Desktop (`md:` and up) behavior — sizing, positioning, and input auto-focus — stays byte-for-byte
  unchanged. Both changes here are mobile-only.
- The existing feature-detection/fallback contract from the prior spec still holds: when
  `visualViewport` is unsupported, fall back to today's pre-fix `inset-0` sizing, never worse than
  that baseline.
- The hook's existing injectable-`targetWindow` testability convention is preserved.

**Ask First:** None — the auto-focus removal was already confirmed with the user this session.

**Never:**
- No change to desktop's existing auto-focus-on-open behavior.
- No introduction of the `interactive-widget=resizes-content` viewport-meta approach in this spec
  — research flagged it as a viable *alternative* strategy, but swapping strategies entirely is a
  larger, riskier change than patching the existing `visualViewport`-based approach's actual gap;
  out of scope here.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mobile, panel opens | User taps launcher | Input is NOT auto-focused; header, messages, and input all visible at full height | N/A |
| Mobile, user taps input | Keyboard opens, `visualViewport` shrinks and its origin shifts (`offsetTop > 0`) | Panel's `top` and `height` both track the visual viewport; header and input both remain visible on-screen | N/A |
| Mobile, keyboard closes | `offsetTop` returns to `0`, height grows back | Panel returns to `top: 0`, full height | N/A |
| `visualViewport` unsupported | Old/unusual browser | Falls back to `inset-0` (unchanged from prior spec's fallback) | No crash |
| Desktop (`md:` and up) | Any state | No change — auto-focus still fires, popup sizing/position unaffected | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/components/quill/use-visual-viewport-height.ts:18-50` -- current hook returns only
  `height`; needs to also return `offsetTop` (e.g. change return type to
  `{ height, offsetTop } | undefined`, or add a second returned value) — same
  `resize`/`scroll` listeners already fire for both, this is a "read one more property" change,
  not new subscription logic.
- `apps/web/src/components/quill/quill-panel.tsx:469,482,489` -- `usesVisualViewportSizing`, the
  class-swap (`inset-x-0 top-0` vs `inset-0`), and the inline `style={{ height }}` — needs `top:
  offsetTop` added to that same inline style object instead of the static `top-0` Tailwind class
  once `usesVisualViewportSizing` is true.
- `apps/web/src/components/quill/quill-panel.tsx:270-271` -- the mount-time
  `inputRef.current?.focus()` effect — needs to become mobile-conditional (reuse the existing
  `isMobile` state already computed lower in the file at line 289; this effect runs earlier in
  the file, so `isMobile`'s declaration likely needs to move above it, or the effect needs to be
  reordered after `isMobile` is available).
- `apps/web/specs/components/quill/use-visual-viewport-height.spec.ts` -- existing hook tests
  assert a bare number return; will need updating for whatever shape the hook returns now.
- `apps/web/specs/components/quill/quill-widget.spec.tsx:201+` -- the review-added
  "visualViewport-driven mobile sizing" test stubs `window.visualViewport` with only `height` set;
  needs an `offsetTop` case added, and any test relying on auto-focus firing on mobile open will
  need updating now that it's tap-to-focus on mobile.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/quill/use-visual-viewport-height.ts` -- extend to also track and
      return `visualViewport.offsetTop` alongside `height` (both updating on the same existing
      `resize`/`scroll` listeners).
- [x] `apps/web/src/components/quill/quill-panel.tsx` -- consume the extended hook; when
      `usesVisualViewportSizing` is true, apply both `height` and `top: offsetTop` via inline
      style (dropping the static `top-0` Tailwind class in that branch, keeping `inset-x-0`).
- [x] `apps/web/src/components/quill/quill-panel.tsx` -- gate the mount-time input autofocus effect
      on mobile-vs-desktop (desktop unaffected; mobile no longer auto-focuses on open). Implemented
      by checking `window.matchMedia` directly and synchronously inside the autofocus effect's own
      body rather than depending on the existing `isMobile` React state: that state starts `false`
      on every mount and only flips after a separate effect's `setState` commits on a *later*
      render, so gating on it left the autofocus effect always seeing the stale pre-detection
      `false` during the initial mount's effect flush regardless of declaration order (confirmed via
      a failing test during this fix, then corrected).
- [x] `apps/web/specs/components/quill/use-visual-viewport-height.spec.ts` -- update existing tests
      for the new return shape; add a case asserting `offsetTop` updates independently on a
      `scroll` event (distinct from a `resize`-driven height change).
- [x] `apps/web/specs/components/quill/quill-widget.spec.tsx` -- update/add a test stubbing both
      `height` and a non-zero `offsetTop` on `window.visualViewport`, asserting the panel's inline
      `style.top` matches; update or remove any assertion that mobile auto-focuses on open, and add
      a test confirming the input does NOT receive focus automatically on mobile.

**Acceptance Criteria:**
- Given a mobile viewport with `visualViewport` support and a non-zero `offsetTop` (simulating the
  keyboard-open scroll shift), when the panel renders, then its inline `top` style matches
  `offsetTop` (verified live via a real-browser check, not just jsdom, per the prior spec's own
  residual-risk note about jsdom's `visualViewport` limitations).
- Given a mobile viewport, when the panel opens, then the input is not focused and no keyboard
  opens until the user taps it.
- Given a desktop viewport, when the panel opens, then the input is still auto-focused exactly as
  before.
- Given the existing test suite, when run after these changes, then every test still passes.

## Design Notes

Per MDN's Visual Viewport API docs and this session's research: `position: fixed` elements are
anchored to the *layout* viewport, while `visualViewport.offsetTop` reports how far the *visual*
(actually-visible) viewport's origin has shifted down within that layout viewport once the keyboard
forces a scroll. Tracking `height` alone (the prior spec's gap) only fixes sizing, not position —
both must be applied together, which is exactly what this spec closes.

## Verification

**Commands:**
- `npx nx run-many -t test,build,lint --projects=web` -- expect full pass, no regressions.

**Manual checks (if no CLI):**
- Real-browser (not jsdom) check at a mobile viewport: simulate a `visualViewport` resize+scroll
  with both a shrunk `height` and a non-zero `offsetTop`, and confirm the panel's rendered
  bounding box (header included) stays fully within the visible area rather than shifting off
  above or below it.

## Suggested Review Order

**The actual gap: tracking `offsetTop`, not just `height`**

- Entry point — the hook now returns `{ height, offsetTop }` instead of a bare number; both
  update off the same existing `resize`/`scroll` listeners.
  [`use-visual-viewport-height.ts:301`](../../apps/web/src/components/quill/use-visual-viewport-height.ts#L301)

- Where the panel actually applies `top: offsetTop` — the one line this whole spec exists to add.
  [`quill-panel.tsx:524`](../../apps/web/src/components/quill/quill-panel.tsx#L524)

**Mobile switches to tap-to-focus**

- Autofocus now checks the mobile viewport synchronously inside its own effect body, not via the
  `isMobile` React state — that state lags a render behind on first mount, which would have
  silently defeated this exact fix.
  [`quill-panel.tsx:304`](../../apps/web/src/components/quill/quill-panel.tsx#L304)

- The review-added shared helper, closing a duplication the review caught between this effect
  and the separate `isMobile` state effect.
  [`quill-panel.tsx:30`](../../apps/web/src/components/quill/quill-panel.tsx#L30)

**Tests proving both fixes**

- Confirms `top` tracks a non-zero `offsetTop` live — the scenario the prior spec's fix silently
  got wrong.
  [`quill-widget.spec.tsx:261`](../../apps/web/specs/components/quill/quill-widget.spec.tsx#L261)

- Review-added: confirms desktop ignores `offsetTop` entirely, regardless of what
  `visualViewport` reports.
  [`quill-widget.spec.tsx:288`](../../apps/web/specs/components/quill/quill-widget.spec.tsx#L288)

- Confirms `offsetTop` updates independently of `height` — the two properties don't always
  change together.
  [`use-visual-viewport-height.spec.ts:90`](../../apps/web/specs/components/quill/use-visual-viewport-height.spec.ts#L90)

**Peripherals**

- Deferred item: cross-combination event/property test symmetry, low marginal value given a
  shared handler already covers both properties every time.
  [`deferred-work.md`](deferred-work.md)

