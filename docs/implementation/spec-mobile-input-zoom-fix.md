---
title: 'Fix: iOS Safari auto-zoom on mobile inputs'
type: 'bugfix'
created: '2026-09-17'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Ahead of sharing the live app on LinkedIn, tapping into either the Browse Papers
search box or the quill chat's "Ask a question" input on a mobile phone (reported first-hand on
iPhone Safari) zoomed the entire page in and left it zoomed until the user manually pinched back
out -- reported as "the chat looks really scrunched, I have to zoom out."

**Approach:** Confirmed live (Playwright at a 390x844 mobile viewport, then cross-checked against
the reported iPhone screenshots) that both inputs' computed `font-size` was `14px`
(Tailwind `text-sm`) -- under iOS Safari's well-known 16px auto-zoom-on-focus threshold. Raised
both to 16px (`text-base`) below the `md` breakpoint only, preserving the existing 14px size at
`md` and up so desktop is unaffected.

## Boundaries & Constraints

**Always:** Desktop (`md:` and up) rendering stays byte-for-byte unchanged -- this is a mobile-only
fix, not a global font-size change.

**Never:** No new shared `Input` component was introduced (none exists in this repo today) --
each of the two affected `<input>` elements was fixed independently, matching how they were
already independently hardcoded.

</intent-contract>

## Code Map

- `apps/web/src/components/quick-find-search.tsx:38` -- the Browse Papers search box's `<input>`,
  hardcoded `text-sm`.
- `apps/web/src/components/quill/quill-panel.tsx:483` -- the quill chat's "Ask a question…"
  `<input>`, hardcoded `text-sm`.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/components/quick-find-search.tsx` -- changed `text-sm` to `text-base md:text-sm`.
- `apps/web/src/components/quill/quill-panel.tsx` -- changed `text-sm` to `text-base md:text-sm`.

**Acceptance Criteria:**
- Given a mobile viewport (< `md`), when either input is focused, then its computed font-size is
  16px (verified live via Playwright: both resolve to `16px`).
- Given a desktop viewport (>= `md`), when either input is rendered, then its computed font-size
  is unchanged at 14px.

## Design Notes

This is the standard, well-documented fix for iOS Safari's input-focus auto-zoom behavior: Safari
zooms the viewport to make sub-16px input text legible on focus, then leaves that zoom level in
place after blur, requiring a manual pinch-zoom-out. Below the ~16px line, the fix is always
"raise the font-size," not a viewport-meta trick (`maximum-scale=1`/`user-scalable=no` disables
pinch-zoom entirely, an accessibility regression, so it was not used here).

## Verification

**Commands:**
- `npx nx run-many -t test,build,lint --projects=web` -- full pass, no regressions.

**Manual checks:**
- Playwright at a 390x844 viewport against both the deployed site and a local `npm run dev`
  session: opened the quill chat, focused both inputs, read `getComputedStyle(el).fontSize` --
  confirmed `16px` for both before merge. Also visually re-checked the chat panel's message
  layout, error states, and the Paper Reader page at the same viewport -- no other mobile-specific
  layout defects found in this pass.

## Auto Run Result

**Summary:** Fixed the reported "mobile chat looks scrunched, have to zoom out" bug. Root cause
was iOS Safari's auto-zoom-on-focus triggering on two `<input>` elements rendered at 14px
(Tailwind `text-sm`) -- below Safari's 16px threshold. Both raised to 16px below `md`, desktop
unchanged.

**Files changed:**
- `apps/web/src/components/quick-find-search.tsx` -- `text-sm` → `text-base md:text-sm`.
- `apps/web/src/components/quill/quill-panel.tsx` -- `text-sm` → `text-base md:text-sm`.

**Review findings breakdown:** No formal multi-layer review pass was run for this fix -- the
change was small, well-isolated (two one-line className edits, no logic change), and its effect
was directly verified live via Playwright rather than through review-then-patch. No findings to
triage.

**Verification performed:** `npx nx run-many -t test,build,lint --projects=web` passed. Live
Playwright checks (pre-merge, against the deployed site and local dev) confirmed both inputs
compute to 16px on a 390px-wide viewport, and confirmed no other mobile layout regressions in the
chat panel, message rendering, or Paper Reader page.

**Residual risks:** None identified for this specific fix. The broader "is the whole site polished
enough for a public LinkedIn post" question was only checked at one representative viewport width
(390px, iPhone-class) and only via automated browser tooling, not on a range of real devices --
worth a quick on-device confirmation once this deploys, which the user planned to do directly on
their own phone.

Merged via PR #45: https://github.com/scotthun/federalist_papers_ai_research_assistant/pull/45
