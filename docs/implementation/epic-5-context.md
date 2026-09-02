# Epic 5 Context: Ask the Archive via the Quill

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Replace the existing inline "Ask the Archive" page section with a persistent, floating quill-icon chat widget available on every page. Users ask questions from anywhere in the app and get streaming, citation-grounded answers, can navigate to the exact cited passage, see related-paper suggestions surfaced from the same retrieval call, and get automatic (removable) scoping to whichever paper they're currently reading. This is a front-door redesign only — the underlying ask/retrieval/citation-verification pipeline is reused as-is, not rebuilt.

## Stories

- Story 5.1: Quill Widget — Launcher, Panel & Streaming Ask
- Story 5.2: Chat Persistence & Page-Aware Context
- Story 5.3: Related Papers in Chat

## Requirements & Constraints

- The quill widget is stateless per message server-side: each chat message is an independent request to the existing ask endpoint, with no server-side conversational memory and no follow-up resolution (a "what about him?" style question won't resolve against a prior turn). This follows from having no auth/user accounts.
- Chat history is client-side only, held in `sessionStorage` (not `localStorage`, not a cookie): it survives navigation between pages in the same tab but clears on tab close. No network or database round-trip for history.
- The paper-context chip's filter reuses the existing paper-number retrieval filter mechanism (filter-before-limit) — it is not a new filtering capability.
- Every chat message still counts as one request against the existing per-IP/global-daily rate limiter — no special-casing for messages that are part of a conversation.
- Citations must never appear before the full response passes existing server-side citation verification; a confident-tier answer streams token-by-token, but citations attach only once verification completes. Clarify- and refuse-tier responses are code-generated, non-streamed, and instant (no LLM call).
- Related-papers list must come from the same retrieval call already made for the question — no separate/secondary retrieval call to populate it.
- WCAG 2.2 AA is the accessibility floor: full keyboard operability, ≥44px tap targets, streaming answer bubble uses `aria-live="polite"`.
- This epic retires the old inline two-column "Ask the Archive" layout and its private selected-citation/paper state machine entirely — it is deleted, not left running alongside the quill.
- Reuse `PaperReader` and the existing paper-by-number API route as-is; citation clicks navigate using already-held paper number + passage data, no re-fetch by chunk ID.

## Technical Decisions

- **No server-side chat session model.** Nothing about chat conversations is persisted to the database. Don't introduce a `ChatSession`/`ChatMessage` table — this is an explicit, deliberate scope-discipline decision, not an oversight.
- **Send-control double-submit guard.** The send control must disable while a response is streaming to prevent duplicate in-flight requests from a double click/tap.
- **Stream failure handling.** If the connection drops mid-stream, the partial text already received stays visible with a quiet inline error (e.g. "Connection lost — try asking again"); no auto-retry; the send control re-enables so the user can resubmit manually.
- **Context chip scoping is per-paper, not per-conversation.** Removing the chip on Paper N suppresses it only while the user remains on Paper N's reader; navigating to a different paper (Paper M) re-evaluates and shows the chip again fresh.
- **Citation vs. related-paper click mechanics are identical** except related-paper clicks never scroll to/highlight a passage (they weren't a cited passage, just a same-retrieval-call sibling paper).
- **Related-papers list omission.** If the retrieval call returned no papers beyond the ones actually cited, omit the "Related papers" section entirely — no empty-state placeholder.
- Streaming, tiering, and citation verification are the existing backend pipeline; this epic is a frontend/API-consumption change plus the addition of an SSE/streaming-token contract, not a retrieval or verification redesign.

## UX & Interaction Patterns

- Launcher: 56px icon, fixed bottom-right, collapsed by default on every page. First-time visit in a browser session: pulses once, auto-opens a tooltip ("Ask me about the Federalist Papers →"), then settles to icon-only permanently for that session — no repeat nudge on return visits.
- Panel: opens on click/tap or keyboard (Tab + Enter/Space), with focus moved into the question input. Desktop (`≥ md`): 340px popup docked bottom-right, page visible behind it. Mobile (`< md`): full-screen takeover with a close/back control.
- Visual identity: "Parchment & Manuscript" tokens from `DESIGN.md` — aged-parchment surfaces, oxblood accent for actionable/citation elements, and a distinctive dog-eared panel shape (asymmetric corner radius, tight corner bottom-left pointing at the launcher). Not a generic rounded-rectangle modal or default chat-widget look.
- Citation links and the related-papers list share the same visual treatment: oxblood color, dotted underline.
- Clicking a citation or related-paper link navigates the underlying page to that paper's Reader and collapses the quill panel back to the launcher icon — without clearing conversation history. This is the one interaction where the quill affects the page rather than staying self-contained.
- Context chip: "📄 Federalist No. {N}" pre-filled with the paper's title, appears at the top of the message list only when opened from a Paper Reader page; has a visible `✕` to remove it. No chip on Homepage/Browse Papers — input placeholder alone signals archive-wide scope there.
- Rate-limited state (from Epic 4's cap) has a fixed chat-surface message; existing history remains visible/scrollable and no other input-disabling behavior is added.

## Cross-Story Dependencies

- Story 5.1 is foundational: it deletes the old inline ask UI and establishes the launcher/panel/streaming mechanics that 5.2 and 5.3 build on.
- Story 5.2's context chip depends on 5.1's panel and ask-request flow already being in place.
- Story 5.3 supersedes the old Story 3.4 (main-page "Related Papers" section) — same underlying mechanism (reuse retrieval results, no new call), new presentation location (in-chat, below the answer bubble), and depends on 5.1's streaming-complete signal to know when to render.
- All three stories depend on the existing ask endpoint, retrieval/filter mechanism, and citation verification pipeline from earlier epics remaining unchanged — this epic is additive on the frontend/API-consumption side only.
