---
title: 'Fix: let the browser resize around the mobile keyboard (drop custom JS)'
type: 'bugfix'
created: '2026-09-18'
status: 'blocked'
baseline_commit: '2f6e194640e729bb9dd699f9d22e24ec5c048bce'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two prior fixes hand-rolled the quill panel's keyboard-aware sizing via
`window.visualViewport` JS tracking (height, then offsetTop) -- each round fixed one symptom and
surfaced another (most recently, a live-device flash during the keyboard-close transition, since
`resize`/`scroll` can fire in a rapid burst faster than a React re-render can keep up). This is a
sign the approach itself is too fragile, not that it needs a fourth patch.

**Approach:** Opt into the CSS/viewport-meta `interactive-widget: resizes-content` setting (Next.js
has first-class typed support for this via its `viewport` export) so the *browser itself* shrinks
the layout viewport when the keyboard opens -- no JS tracking, no per-event re-renders, nothing to
lag. Revert the panel to its original plain `fixed inset-0` (no inline style, no
`visualViewport`-derived height/top), and delete the now-unnecessary `useVisualViewportHeight` hook
and its tests entirely. Desktop is unaffected: `interactive-widget` only has any effect when an
on-screen keyboard is shown at all, which never happens on non-touch desktop browsers.

## Boundaries & Constraints

**Always:**
- Desktop (`md:` and up) behavior — sizing, positioning — stays exactly as it is today.
  `interactive-widget` is a no-op on browsers with no on-screen keyboard.
- Tap-to-focus on mobile / auto-focus on desktop (prior fix) is unchanged — kept regardless of
  this fix's outcome, since it's independently good practice.
- The mobile body-scroll lock (prior fix) is unchanged.
- On a very old browser lacking `interactive-widget` support, the panel falls back to plain
  `fixed inset-0` with no special keyboard handling — the pre-any-of-these-fixes baseline, not a
  regression below it.

**Ask First:** None.

**Never:**
- No reintroduction of `window.visualViewport` JS tracking for panel sizing -- that's the whole
  approach being retired here.
- No `maximum-scale=1`/`user-scalable=no` -- still an accessibility regression, still unnecessary.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mobile, keyboard opens (modern browser) | `interactive-widget: resizes-content` supported | Browser shrinks the layout viewport itself; the panel's plain `inset-0` sizing naturally tracks it with zero JS involvement, zero flicker | N/A |
| Mobile, keyboard closes | Same | Panel returns to full height/position automatically, browser-driven | N/A |
| `interactive-widget` unsupported | Old/unusual browser | Falls back to plain `fixed inset-0` (the original, pre-fix baseline) | No crash |
| Desktop | Any state | No behavior change at all — `interactive-widget` has no effect without an on-screen keyboard | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/src/app/layout.tsx` -- no `viewport` export exists today (confirmed via full-file
  read); Next.js 16's typed `Viewport` export (from `next`) supports `interactiveWidget:
  'resizes-content'` natively, which maps to the `interactive-widget` value in the rendered
  `<meta name="viewport">` tag.
- `apps/web/src/components/quill/quill-panel.tsx:350,501,516,523-527` -- revert entirely: remove
  `useVisualViewportHeight` import/usage, `usesVisualViewportSizing`, and the inline
  `style={{ height, top }}`. The mobile branch goes back to a single static `inset-0` class,
  identical to the code's state before `spec-mobile-keyboard-panel-clipping.md` first introduced
  the JS-based approach.
- `apps/web/src/components/quill/use-visual-viewport-height.ts` -- delete entirely; no longer
  consumed anywhere once the above revert lands.
- `apps/web/specs/components/quill/use-visual-viewport-height.spec.ts` -- delete entirely (tests a
  file that no longer exists).
- `apps/web/specs/components/quill/quill-widget.spec.tsx` -- the "visualViewport-driven mobile
  sizing" describe block (four tests: height sizing, offsetTop positioning, desktop-ignores-
  offsetTop, and the underlying mechanism) all test behavior being removed; delete that whole
  block. The unrelated tap-to-focus and body-scroll-lock describe blocks are untouched.
- `apps/web/src/components/quill/quill-panel.tsx` -- `isMobile` state, the `isMobileViewport()`
  helper, tap-to-focus gating, and the body-scroll lock effect are all untouched by this spec —
  only the `visualViewport`-driven sizing is being retired.

## Tasks & Acceptance

**Execution:**
- [x] `apps/web/src/app/layout.tsx` -- add `export const viewport: Viewport = { width:
      'device-width', initialScale: 1, interactiveWidget: 'resizes-content' };` (importing
      `Viewport` from `next`), matching Next.js's default `width=device-width, initial-scale=1`
      values explicitly since adding a custom `viewport` export replaces Next's implicit default
      rather than merging with it.
- [x] `apps/web/src/components/quill/quill-panel.tsx` -- remove the `useVisualViewportHeight`
      import, the `visualViewportMetrics`/`usesVisualViewportSizing` variables, and the inline
      `style` prop; the mobile branch's class list goes back to a plain `inset-0` (no conditional).
- [x] `apps/web/src/components/quill/use-visual-viewport-height.ts` -- delete.
- [x] `apps/web/specs/components/quill/use-visual-viewport-height.spec.ts` -- delete.
- [x] `apps/web/specs/components/quill/quill-widget.spec.tsx` -- delete the
      "visualViewport-driven mobile sizing" describe block.

**Acceptance Criteria:**
- Given the rendered page's `<head>`, when inspected, then a `<meta name="viewport">` tag includes
  `interactive-widget=resizes-content` alongside `width=device-width, initial-scale=1`.
- Given a mobile viewport, when the panel opens, then it uses plain `fixed inset-0` with no inline
  style and no `visualViewport`-derived JS logic anywhere in the component.
- Given a desktop viewport, when the panel opens, then behavior is unchanged from before this fix.
- Given the existing test suite, when run after these changes, then every remaining test still
  passes (with the deleted-behavior tests removed, not just skipped).

## Design Notes

This is a "subtract code" fix, not an "add code" one — the entire point is retiring machinery that
turned out to be more fragile than the platform-native alternative. `interactive-widget:
resizes-content` shrinks the actual layout viewport (not just the visual viewport), so ordinary CSS
positioning (`inset-0` on a `fixed` element, which sizes itself against its containing block) just
naturally tracks the keyboard with no JS at all -- eliminating the height-tracking, offsetTop-
tracking, and render-timing-flicker bugs all three at once, because there's no longer any custom
code left for any of them to occur in.

## Verification

**Commands:**
- `npx nx run-many -t test,build,lint --projects=web` -- expect full pass, no regressions.

**Manual checks (if no CLI):**
- View page source / inspect the rendered `<head>` and confirm the viewport meta tag includes
  `interactive-widget=resizes-content`.
- Real-device check (the user's own phone, once deployed): open the chat, tap the input, confirm
  the keyboard opens with the header/input both staying visible and no flash during open or close.

## Auto Run Result

**Status: blocked.** This spec's entire premise was factually wrong and the implementation was
reverted. Blind-hunter review flagged that `interactive-widget=resizes-content` isn't supported by
iOS Safari; independently verified against MDN's canonical browser-compat-data source
(`html/elements/meta/name/viewport/interactive-widget.json`): `safari: { version_added: false }`,
`safari_ios: "mirror"` (also `false`). As of today, this is a **Chrome Android / Firefox Android
-only** feature -- no WebKit platform (macOS or iOS Safari) supports any `interactive-widget` value
at all. WebKit's own public feature-status page (webkit.org/status) has zero mentions of it.

This directly contradicts an earlier research pass this session that claimed "Safari support
arrived later (iOS/Safari 17.4+)... by 2026 this covers the vast majority of real traffic" -- that
claim was wrong (likely a hallucinated/outdated assumption, not grounded in an actual compat-data
check at the time). Given every live bug report this whole investigation has been chasing came from
an iPhone, this approach would have silently regressed the user's actual device back to the
pre-any-of-these-fixes broken state, while deleting JS code (`useVisualViewportHeight`) that had
already been confirmed live, three separate times, to correctly reposition the panel on that exact
device -- only the keyboard-close *transition* still had a visible flash.

**All code changes reverted** back to the prior commit's state (`use-visual-viewport-height.ts`
and its tests restored, `quill-panel.tsx`/`layout.tsx` reverted) -- the currently-deployed,
JS-based fix on `main` is intact and unaffected by this spec's failed attempt.

**Recommendation for the next spec:** the original, still-outstanding problem is real (a visible
flash during the keyboard-close animation, since rapid `resize`/`scroll` events can outpace a React
re-render) -- apply the fix already researched and drafted before this detour: write `height`/`top`
directly to the panel's DOM node via a ref inside the `visualViewport` event handler, bypassing
`setState` (and therefore React's render-scheduling lag) entirely for those two properties. This
was the approach in progress immediately before switching to the (now-disproven)
browser-native detour.
