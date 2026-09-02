---
name: Federalist Research
status: final
sources:
  - docs/planning/specs/spec-federalist-research/ui-design.md
  - docs/planning/epics.md
updated: 2026-09-02
---

# Federalist Research — Experience Spine

Multi-surface responsive web: a single-column reading application (Browse Papers, Paper Reader) with one global, floating conversational surface (the quill) layered on top. `DESIGN.md` is the visual identity reference; this spine is the experience. **Spines win on conflict** with any mock, wireframe, or import — including `mockups/direction-parchment-manuscript.html` and the key-screen mocks below.

**Supersedes `ui-design.md` §"Ask the Archive."** The prior spec's prominent inline question input on the main page is removed entirely, replaced by the floating quill launcher (`.memlog.md` decisions, 2026-09-01). The two-column split described in `ui-design.md` §"Layout" (left: search/answer, right: sources/citations) was that inline box's layout and is retired with it — see Foundation and Key Flows below for what replaces it. Everything else in `ui-design.md` (Answer contents, Related Papers, Browse Papers, Paper Reader contents, verification link placement, citation navigation guarantees) carries forward unchanged; the quill is a new front door to the same underlying answer/citation data.

## Foundation

Responsive web, no named UI system — custom components per `DESIGN.md`. Two independent surfaces:

1. **The page** — Homepage (Browse Papers) and Paper Reader, each a conventional single-column document, unaffected by the quill's open/closed state (`.memlog.md`, "chat widget is global... underlying page is unaffected").
2. **The quill** — a global, session-persistent conversational layer. On desktop it is a small corner-docked popup; on mobile/small screens (`< md`, [ASSUMPTION: 768px breakpoint, matching the codebase's existing responsive convention — confirm against `apps/web`'s actual breakpoint token]) it becomes a full-screen takeover, since a fixed-width popup doesn't leave a usable page underneath at phone widths (`.memlog.md`).

Chat history is session-level state that survives navigation between pages (`.memlog.md`, "similar to RoboChat/Confluence pattern") — closing the popup or navigating away never clears the conversation.

## Information Architecture

| Surface | Reached from | Purpose |
|---|---|---|
| Homepage | App open | "Federalist Research" header/subtitle, Browse Papers list. No inline question box — the quill launcher is the entry point to asking a question. |
| Browse Papers | Homepage (it *is* the homepage body) | All 85 papers, number + title + author(s) (`ui-design.md`). |
| Paper Reader | Browse Papers row tap, or a citation click from the quill | Paper number, title, author(s), full text, cited passage-in-context when arrived via citation, verification tag. |
| Quill — collapsed | Default state, every page | 56px launcher icon, bottom-right. |
| Quill — popup (desktop) | Launcher tap | Question input, streaming answer, citations, optional page-aware context chip. |
| Quill — full-screen (mobile) | Launcher tap on `< md` | Same content as the popup, full viewport. |

→ Composition reference: `mockups/direction-parchment-manuscript.html` (chosen visual direction), `mockups/key-home.html`, `mockups/key-chat-popup.html`, `mockups/key-chat-mobile.html`, `mockups/key-paper-reader-citation.html`. Spine wins on conflict.

**Mock coverage.** Mocked: Homepage-with-collapsed-quill, quill popup (desktop, mid-stream), quill full-screen (mobile), Paper Reader post-citation-click. Spine-only (no visual mock — built from the tables below and `ui-design.md`'s existing description): Browse Papers' own scroll/search behavior (unchanged from the current implementation, see `home-full.png`/`answer-view.png` for the pre-existing rows this workspace does not alter), Paper Reader reached via a plain Browse Papers row tap (no citation, no quoted-passage panel — the simpler of its two states), the first-visit discoverability pulse/tooltip (a transient animation, not a static composition). Logged per `.memlog.md` event, 2026-09-02.

## Voice and Tone

Microcopy. Brand voice and aesthetic posture live in `DESIGN.md`.

| Do | Don't |
|---|---|
| "🪶 Ask the Archive" | "Chat with AI" / "Ask me anything!" |
| "Ask me about the Federalist Papers →" (one-time nudge) | "👋 Need help? Chat now!" |
| "Ask a question of the Papers…" (input placeholder) | "Type your message..." |
| "I couldn't find sufficient evidence in the Federalist Papers to answer that confidently." (refuse tier, verbatim from `epics.md` Story 3.2) | "Sorry, I don't know that." |
| "Source: Avalon Project ↗" (verification tag, verbatim from `ui-design.md`) | "Verified ✓" |
| Plain, complete sentences; no exclamation marks | Emoji beyond the quill (🪶) and the context-chip document glyph (📄) |

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Launcher (quill) | Every page, bottom-right | Collapsed by default. First visit only: pulses once, tooltip auto-opens with the nudge copy, then permanently settles to icon-only for the session (`.memlog.md`). Click toggles the panel open/closed; state (open/closed, not conversation history) resets to collapsed on a fresh session. |
| Chat panel | Desktop popup / mobile full-screen | Opens with focus in the input. Streams answer tokens word-by-word (`.memlog.md`). Closing (desktop: header collapse control; mobile: back/close control) returns to the collapsed launcher without clearing history. |
| Context chip | Chat panel, top of message list | Appears automatically when the quill is opened from a Paper Reader page, pre-filled with that paper's title (`ui-design.md` paper title, e.g. "📄 Federalist No. 10"). Removable via `✕` — removing it scopes the next question back to the whole archive rather than the single paper. Removal is per-paper: it does not reappear while the user stays on that same Paper Reader page, but navigating to a *different* paper's Reader (e.g. via a citation or related-paper click) re-evaluates the chip fresh and it appears again for the new paper (`epics.md` Story 5.2, party-mode review 2026-09-02). |
| Citation-link (inline, in an answer bubble) | Chat panel | Click navigates the page (not the panel) to the Paper Reader for that citation's paper, passes the already-held `paperNumber` + quoted passage (no re-fetch by `chunkId`, `epics.md` Story 3.3 / NFR8), and scrolls to/highlights the passage. The quill panel collapses to the launcher on this navigation [ASSUMPTION: full-page navigation away from an open popup is disorienting if the popup stays open and detached from context — collapsing on navigate keeps one thing changing at a time; conversation history is preserved and reopening the launcher shows the same thread]. |
| Related-papers list | Chat panel, below the answer bubble | Renders once streaming completes (never mid-stream — a derived/secondary signal, not the primary answer). Same visual treatment as citation links (oxblood, dotted-underline). Click navigates to that paper's Reader and collapses the panel to the launcher, identical mechanics to a citation click, but with no passage highlight — it's a related read, not a cited sentence (`.memlog.md`, 2026-09-02). |
| Verification tag | Paper Reader, near title | Static, quiet, one line. Never repeated per-passage. |
| Paper row | Browse Papers | Tap/click → Paper Reader for that paper, no quoted-passage panel (plain read, not arrived via citation). |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| First visit (cold) | Any page, quill | Pulse + auto-open tooltip once, then collapse to icon-only for the remainder of the session. |
| Idle / returning visit | Quill | Icon-only, no pulse, no tooltip — established users don't get repeat nudges. |
| Streaming | Chat panel | Answer bubble grows word-by-word with a trailing cursor; a quiet "streaming…" caption sits below it (`DESIGN.md` `{typography.caption}`, `{colors.ink-muted}`). |
| Confident answer | Chat panel | Full answer + inline citations render per `epics.md` Story 3.1; a related-papers list renders below the bubble once streaming completes (see Component Patterns). |
| Clarify tier | Chat panel | Code-generated, non-streamed message naming the best-guess paper and asking for more detail (`epics.md` Story 3.2) — renders instantly, no streaming cursor, since no LLM call occurs. |
| Refuse tier | Chat panel | The fixed refuse-tier sentence (see Voice and Tone), no citations, no streaming cursor. |
| Page-aware context present | Chat panel, on open from Paper Reader | Context chip shown per Component Patterns. |
| Whole-archive (no context) | Chat panel, on open from Homepage/Browse | No chip; input placeholder alone signals archive-wide scope. |
| Rate-limited [NOTE FOR UX: `epics.md` Story 4.2 defines a daily/per-minute cap but does not specify chat-surface copy; the fixed message below is this workspace's best-effort default, not a memlog decision — confirm wording before ship] | Chat panel | "The Archive has reached today's question limit — please try again tomorrow." No input disabled state beyond this; existing history remains visible and scrollable. |
| Citation clicked | Chat panel → Paper Reader | Panel collapses to launcher (see Component Patterns); Paper Reader shows quoted passage above/beside full text, highlighted where practical (`ui-design.md`). |
| Empty Browse Papers search | Browse Papers | Unchanged from current implementation — out of this workspace's scope. |

## Interaction Primitives

- Click/tap to act everywhere; no drag, no swipe gestures introduced.
- Enter (desktop) / send-button tap (both) submits a question.
- Click the launcher toggles panel open/closed. Click the `✕` on the context chip removes only the chip, never closes the panel.
- Click a citation navigates the page and collapses the panel (see above) — this is the one interaction where the quill affects the underlying page rather than staying self-contained.
- **Banned:** carousels, auto-playing animation beyond the one-time launcher pulse, sound, push-style re-engagement, a second concurrent open panel (mobile full-screen and desktop popup are mutually exclusive by breakpoint, never both).

## Accessibility Floor

Behavioral. Visual contrast lives in `DESIGN.md`.

- WCAG 2.2 AA across both the reading surface and the quill panel; `{colors.accent}` oxblood-on-parchment and `{colors.ink-muted}` combinations verified at AA before ship (`DESIGN.md`'s faded-ink tone is the most contrast-risk-prone token in the palette).
- The launcher and panel are keyboard-operable: `Tab` reaches the launcher, `Enter`/`Space` opens it; focus moves into the input on open and returns to the launcher on close.
- The one-time discoverability tooltip is announced to screen readers on open (`aria-live="polite"`) and does not trap focus.
- Streaming answer text uses `aria-live="polite"` on the answer bubble so assistive tech announces new content without interrupting; the "streaming…" caption is redundant with the live region and may be `aria-hidden`.
- Citations are real links/buttons with accessible names including the paper number, not bare styled spans.
- Tap targets ≥ 44px for the launcher, close control, and citation links.

## Responsive & Platform

| Breakpoint | Behavior |
|---|---|
| `≥ md` (desktop/tablet landscape) | Quill opens as a 340px popup, bottom-right, page visible behind it. |
| `< md` (mobile / narrow) | Quill opens full-screen, replacing the viewport; a close/back control returns to the underlying page. [ASSUMPTION: exact `md` pixel value should match whatever breakpoint token `apps/web` already uses — flagged here rather than invented as a new value.] |

The reading surfaces (Homepage, Browse Papers, Paper Reader) are otherwise a conventional responsive single column at all widths — this workspace does not change their existing responsive behavior, only the quill's.

## Inspiration & Anti-patterns

- **Lifted from Chase / Capital One-style bank site chat widgets:** the floating bottom-right launcher, collapsed-by-default posture (`.memlog.md`).
- **Lifted from Intercom / Drift / Zendesk:** mobile full-screen takeover for the same widget that's a small popup on desktop (`.memlog.md`).
- **Lifted from RoboChat / Confluence-style assistants:** page-aware context offered as a visible, removable chip rather than applied silently; chat history persisting across navigation (`.memlog.md`).
- **Rejected — full-screen takeover chat view as the default (even on desktop):** considered and explicitly deferred as possibly too complex; the corner popup is the shipped default on desktop (`.memlog.md`).
- **Rejected — generic chat-bubble icon for the launcher:** replaced with a feather quill, period-appropriate to the Federalist Papers' 1787 writing era (`.memlog.md`).
- **Rejected — silent page-aware context:** scoping is always visible and reversible via the chip, never applied without the user seeing it (`.memlog.md`).

## Key Flows

### Flow 1 — First-time discovery and citation verification (Priya, law student, researching factions for a paper)

1. Priya lands on the Homepage. The quill launcher pulses once bottom-right; a tooltip auto-opens: "Ask me about the Federalist Papers →". She notices it, and it settles to icon-only.
2. She clicks the launcher. The popup opens, no context chip (she's on the Homepage, not a specific paper) — input alone invites an archive-wide question.
3. She types "What does Madison argue about factions in Federalist No. 10?" and submits.
4. The answer streams in word-by-word; a citation appears mid-sentence, underlined in oxblood.
5. She clicks the citation.
6. **Climax:** the page navigates to the Paper Reader for No. 10; the quoted passage sits above the full text, highlighted; the quill collapses back to the launcher, but her question and Madison's answer are still there the moment she reopens it — she can read the primary source and the AI's summary of it side by side in her own workflow, not the app's.

Failure: top retrieved chunk falls below `clarifyThreshold` → the refuse-tier sentence renders instead of an answer, no citations, no navigation possible.

### Flow 2 — Page-aware follow-up (Priya, five minutes later, still on the No. 10 Paper Reader)

1. Still reading No. 10's full text, Priya reopens the quill.
2. The panel opens with a context chip already present: "📄 Federalist No. 10" — the Archive knows what she's reading.
3. She asks "How does this connect to Federalist No. 51?" — a question that only makes sense with No. 10 as scoped context.
4. **Climax:** the answer streams in, drawing the connection to No. 51, with the chip still visible confirming exactly what was in scope for that answer — she never has to wonder whether the AI understood which paper she meant.

Failure: she wants a whole-archive question instead → she taps `✕` on the chip before asking; the chip disappears and the next question scopes archive-wide.

### Flow 3 — Mobile research session (Devon, on a phone between classes)

1. Devon opens the app on his phone; Browse Papers renders single-column, quill launcher bottom-right as on desktop.
2. He taps the launcher.
3. **Climax:** the panel takes over the full screen rather than a cramped corner popup — full-width input, full-width answer text, still in the same parchment/ink visual language — so reading a multi-paragraph grounded answer on a small screen doesn't mean squinting into a 340px box.
4. He taps a citation; the app navigates to the Paper Reader (also full-screen-appropriate, single column); the quill collapses to icon-only, letting him read the source text with the full width of his phone.

Failure: he rotates to landscape mid-conversation and crosses the `md` breakpoint → [ASSUMPTION: the panel should re-render as the desktop popup rather than staying full-screen, since the breakpoint rule is width-based, not device-based — not explicitly decided in discovery, confirm before ship].
