---
title: 'Fix: quill panel header clips above the mobile keyboard'
type: 'bugfix'
created: '2026-09-17'
status: 'done'
baseline_commit: '4ed4a70ad2e23f94419bcfddc94df596e9ec3904'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** On mobile, opening the quill chat auto-focuses its input, which opens the on-screen
keyboard. The panel (`fixed inset-0`) doesn't shrink to the now-smaller visible viewport, so the
browser's own "scroll focused input into view" behavior shifts the whole panel upward — clipping
the header off the top of the screen until the keyboard is dismissed. Reported live on iOS Safari;
must be fixed for Android Chrome/Samsung Internet too, not an iOS-only patch.

**Approach:** Size the mobile panel to the actual visible viewport using the `window.visualViewport`
resize/scroll events (broadly supported: iOS Safari 13+, Chrome, Firefox, Samsung Internet — not an
iOS-specific API), so the panel's height and top offset always match what's really visible,
keyboard included. Combine with a body-scroll lock while the panel is open, which removes the
scrollable ancestor WebKit's refocus-scroll quirk exploits, addressing the iOS-specific root cause
directly rather than only its symptom.

## Boundaries & Constraints

**Always:**
- Desktop (`md:` and up) popup sizing/positioning (`480px` × `340px`, docked bottom-right) stays
  byte-for-byte unchanged — this fix is mobile-only.
- Feature-detect `window.visualViewport`; when unavailable, fall back to today's `fixed inset-0`
  behavior (no worse than the current state) rather than throwing or breaking the panel.
- Body scroll lock is applied only while the panel is mounted and released on unmount/close —
  never leaks scroll-lock state onto the rest of the app.

**Ask First:** None identified — this is a self-contained mobile-viewport fix with no cross-cutting
product decisions.

**Never:**
- No change to `apps/web/src/components/quill/quill-widget.tsx`'s open/close state management or
  message logic — this is a pure layout/positioning fix inside `QuillPanel`.
- No `maximum-scale=1`/`user-scalable=no` viewport-meta trick — that disables pinch-zoom entirely,
  an accessibility regression, and isn't necessary given the `visualViewport` approach.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mobile, keyboard closed | Panel opens, `visualViewport` available | Panel height matches full visible viewport, header visible | N/A |
| Mobile, keyboard opens | Input focused, `visualViewport.resize` fires with a smaller height | Panel shrinks to the new visible height; header and input both stay on-screen | N/A |
| Mobile, keyboard closes | User dismisses keyboard | Panel grows back to full visible height | N/A |
| `visualViewport` unsupported | Old/unusual browser lacking the API | Falls back to current `fixed inset-0` sizing (today's behavior, not worse) | No crash, no console error |
| Desktop (`md:` and up) | Any viewport/keyboard state | No change — popup stays fixed `480px`×`340px` | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/components/quill/quill-panel.tsx:398-410` -- outer panel `<div>`, currently
  `fixed inset-0` on mobile / `md:inset-auto md:bottom-4 md:right-4 md:h-[480px] md:w-[340px]` on
  desktop. This is the element that needs dynamic mobile sizing.
- `apps/web/src/components/quill/quill-panel.tsx:250,263-265` -- `inputRef` + the mount-time
  autofocus `useEffect` that triggers the keyboard open (confirmed: panel remounts fresh on every
  open via `quill-widget.tsx`'s conditional render, so this fires on every open, not just re-taps).
- `apps/web/src/components/quill/quill-widget.tsx:124-189` -- parent owning `isOpen` state;
  `QuillPanel` fully mounts/unmounts here (not CSS-hidden) — confirms a mount-time effect in
  `QuillPanel` is the right place for both the scroll-lock and the `visualViewport` subscription.
- No existing scroll-lock, `visualViewport` usage, or viewport-meta customization exists anywhere
  in `apps/web/src` (confirmed via full-repo search) — this is new, first-of-its-kind code, not an
  extension of an existing pattern.
- `apps/web/specs/components/quill/quill-widget.spec.tsx` -- existing test file (jsdom via
  `next/jest`); **jsdom does not implement `window.visualViewport` at all** — new tests must mock/
  stub it, and the true "header stays visible" visual behavior can only be verified live
  (Playwright/real device), not in jsdom.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/components/quill/use-visual-viewport-height.ts` (new) -- a small hook: feature-
      detects `window.visualViewport`, subscribes to its `resize`/`scroll` events while mounted,
      returns the current visible height (`number | undefined`; `undefined` when unsupported).
      Pure, injectable-`window`-arg shape for testability, matching this codebase's existing
      pure-function convention.
- [x] `apps/web/src/components/quill/quill-panel.tsx` -- consume the hook; on mobile only (guard via
      a `matchMedia('(max-width: 767px)')` check, since inline styles would otherwise override the
      `md:` Tailwind classes on desktop), apply the returned height as an inline style replacing
      `inset-0`'s implicit full-height, and switch the mobile positioning classes from `inset-0` to
      `inset-x-0 top-0` (dropping `bottom-0` so an explicit height isn't overconstrained against it).
      Add a mount-time body-scroll lock (`document.body.style.overflow = 'hidden'`, restored on
      unmount) guarded to mobile only, matching the panel's own mobile/desktop split.
- [x] `apps/web/specs/components/quill/use-visual-viewport-height.spec.ts` (new) -- unit tests for
      every I/O matrix row: no `visualViewport` (returns `undefined`), resize event updates the
      returned height, unmount cleans up its event listeners.
- [x] `apps/web/specs/components/quill/quill-widget.spec.tsx` -- add a test confirming the body
      scroll lock is applied on open and released on close (mock `document.body.style.overflow`).

**Acceptance Criteria:**
- Given a mobile viewport with `visualViewport` support, when the panel opens and the keyboard
  appears, then the panel's rendered height matches `visualViewport.height` and the header remains
  in the DOM's visible bounds (verified live via Playwright at a mobile viewport, simulating a
  `visualViewport` resize).
- Given the existing test suite, when run after these changes, then every test still passes.

## Design Notes

`window.visualViewport` (not a plain `resize` listener on `window`) is the standard, cross-browser
mechanism for this exact class of bug — it reports the *actual visible* viewport, separate from
the layout viewport, and fires `resize`/`scroll` events specifically when an on-screen keyboard
opens/closes or the page pinch-zooms. It's supported in iOS Safari, Chrome (desktop and Android),
Firefox, and Samsung Internet — this is why it's preferred over any `interactive-widget` viewport-
meta trick (newer, less universally supported) or a hand-rolled `resize` heuristic.

## Verification

**Commands:**
- `npx nx run-many -t test,build,lint --projects=web` -- expect full pass, no regressions.

**Manual checks (if no CLI):**
- Playwright at a 390×844 mobile viewport: open the panel, simulate a `visualViewport` resize
  (shrinking height to mimic a keyboard opening), and confirm the header element's bounding box
  stays within the visible viewport rather than being pushed above `y=0`.

## Suggested Review Order

**The core fix: sizing the panel to the real visible viewport**

- Entry point — the hook that tracks the actual visible viewport height, feature-detected so
  unsupported browsers fall back safely.
  [`use-visual-viewport-height.ts:19`](../../apps/web/src/components/quill/use-visual-viewport-height.ts#L19)

- Where the hook's value drives the panel's sizing decision — `!!visualViewportHeight` (not
  `!== undefined`) guards against a momentary `0` from iOS collapsing the panel to nothing.
  [`quill-panel.tsx:469`](../../apps/web/src/components/quill/quill-panel.tsx#L469)

- The actual class/style swap: drops `inset-0` for `inset-x-0 top-0` + an explicit inline
  height, so the panel never overconstrains itself against a dropped `bottom-0`.
  [`quill-panel.tsx:482`](../../apps/web/src/components/quill/quill-panel.tsx#L482)

**Removing the root cause: body scroll lock**

- Mobile-only, mount/unmount-scoped lock that eliminates the scrollable ancestor WebKit's
  refocus-scroll quirk exploits — restores the *previous* value, never just `''`.
  [`quill-panel.tsx:328`](../../apps/web/src/components/quill/quill-panel.tsx#L328)

**Cross-browser mobile detection**

- `matchMedia` breakpoint state, with the review-added legacy `addListener` fallback for
  Safari < 14.1 (which lacks `MediaQueryList.addEventListener`).
  [`quill-panel.tsx:289`](../../apps/web/src/components/quill/quill-panel.tsx#L289)

**Tests proving the core fix is actually pinned**

- The review-added test that stubs `window.visualViewport` globally and asserts the real
  class/style swap happens — closes the gap where every prior test had this permanently
  `false` (jsdom has no `visualViewport`).
  [`quill-widget.spec.tsx:201`](../../apps/web/specs/components/quill/quill-widget.spec.tsx#L201)

- Confirms the `matchMedia` `change` listener genuinely re-evaluates mid-life, not just at
  mount (e.g. a tablet rotation crossing the breakpoint).
  [`quill-widget.spec.tsx:159`](../../apps/web/specs/components/quill/quill-widget.spec.tsx#L159)

- Body-scroll-lock behavior: applied on open, released via the real close button, and
  restores a pre-existing non-empty `overflow` value rather than clobbering it.
  [`quill-widget.spec.tsx:94`](../../apps/web/specs/components/quill/quill-widget.spec.tsx#L94)

**Peripherals**

- Full I/O-matrix unit coverage for the hook in isolation (unsupported/resize/scroll/cleanup).
  [`use-visual-viewport-height.spec.ts:1`](../../apps/web/specs/components/quill/use-visual-viewport-height.spec.ts#L1)
