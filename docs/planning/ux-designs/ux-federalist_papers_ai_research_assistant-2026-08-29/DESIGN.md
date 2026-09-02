---
name: Federalist Research
description: Source-grounded AI research assistant for the Federalist Papers. Parchment & Manuscript visual direction — an aged-paper reading room with a period-appropriate quill chat widget.
status: final
colors:
  surface: '#fdfaf3'
  surface-panel: '#fbf6ea'
  surface-panel-alt: '#f4ecd8'
  surface-stripe: '#e8dcc0'
  surface-raised: '#ffffff'
  surface-user-bubble: '#eee3cb'
  surface-chip: '#f0e6cc'
  surface-highlight: '#f6e7c9'
  ink-primary: '#3a2f24'
  ink-secondary: '#6b4f3b'
  ink-muted: '#a08a68'
  border-hairline: '#e6dcc0'
  border-default: '#d8cba8'
  accent: '#8a1f1f'
  accent-gold: '#c9a227'
  launcher-fill: '#2f2418'
  inverse-surface: '#2f2418'
  inverse-on-surface: '#f4ecd8'
typography:
  display:
    fontFamily: 'Georgia, "Times New Roman", serif'
    fontSize: 28px
    fontWeight: '400'
    lineHeight: '1.2'
  heading:
    fontFamily: 'Georgia, "Times New Roman", serif'
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.3'
  reading:
    fontFamily: 'Georgia, "Times New Roman", serif'
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.7'
  body:
    fontFamily: 'Georgia, "Times New Roman", serif'
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  chat:
    fontFamily: 'Georgia, "Times New Roman", serif'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
  caption:
    fontFamily: 'Georgia, "Times New Roman", serif'
    fontSize: 11px
    fontWeight: '400'
    lineHeight: '1.4'
rounded:
  sm: 4px
  md: 8px
  lg: 10px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 24px
  '6': 32px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 48px
components:
  launcher-quill:
    fill: '{colors.launcher-fill}'
    glow: '{colors.accent-gold}'
    size: 56px
    radius: '{rounded.full}'
  chat-panel:
    background: '{colors.surface-panel}'
    border: '{colors.accent-gold}'
    radius: '10px 10px 4px 10px'
  context-chip:
    background: '{colors.surface-chip}'
    border: '{colors.accent-gold}'
    foreground: '{colors.ink-secondary}'
    radius: '{rounded.full}'
  citation-link:
    highlight: '{colors.surface-highlight}'
    foreground: '{colors.accent}'
    marker: 'underline-dotted'
  question-bubble:
    background: '{colors.surface-user-bubble}'
    radius: '10px 10px 2px 10px'
  answer-bubble:
    background: '{colors.surface-raised}'
    border: '{colors.border-hairline}'
    radius: '10px 10px 10px 2px'
  verification-tag:
    foreground: '{colors.ink-muted}'
    style: 'quiet, near paper title, never inline per-passage'
---

## Brand & Style

Federalist Research reads as a page pulled from the Founders' own writing desk, not a generic chatbot skinned onto a document viewer. The product's entire premise is source-grounded trust — every claim traces to a specific paper and passage — and the aesthetic reinforces that premise before a single word is read: aged parchment, hand-set serif type, and sealing-wax red for anything the user can act on.

The posture is **Editorial Archive**, not **Product Chrome**. There is one serif type family throughout — no sans-serif counterpoint — because this is a reading and research tool, not a dashboard. Motion is unhurried: the launcher pulses once like ink settling, answers stream in at a measured, readable pace rather than a flashy typewriter blast, and the chat panel never bounces or springs.

The AI assistant is a **quill**, not a chat bubble. Every touchpoint — launcher icon, panel header ("🪶 Ask the Archive"), tooltip copy — carries the period-appropriate framing established in discovery: this is correspondence with the Archive, not a support widget bolted onto the app.

## Colors

The palette is parchment and ink, with a single warm accent reserved for the things the reader can act on.

- **Parchment White (`{colors.surface}` `#fdfaf3`)** is the page canvas — the outermost background behind every surface.
- **Parchment Panel (`{colors.surface-panel}` `#fbf6ea`)** is the reading surface: cards, the chat panel body, the browser-frame content area. `{colors.surface-panel-alt}` (`#f4ecd8`) and `{colors.surface-stripe}` (`#e8dcc0`) alternate as a faint ruled-paper texture behind long-form text (Paper Reader), never behind interactive controls.
- **Paper White (`{colors.surface-raised}` `#ffffff`)** is reserved for the two things that must read as "the primary source itself": the answer bubble and the quoted-passage panel in the Paper Reader. It is the brightest surface in the system on purpose — it is where the reader's eye should land first.
- **Ink Brown (`{colors.ink-primary}` `#3a2f24`)** is the primary text color everywhere — headings, paper body text, answer text.
- **Warm Sepia (`{colors.ink-secondary}` `#6b4f3b`)** is secondary text and hairline-adjacent borders: subtitles, captions, author bylines, chip labels.
- **Faded Ink (`{colors.ink-muted}` `#a08a68`)** is the quietest text tone — timestamps, the "streaming…" indicator, the verification tag. It must never carry information the reader can't get elsewhere; it is atmosphere, not signal.
- **Oxblood Red (`{colors.accent}` `#8a1f1f`)** is the *only* interactive-accent color: citation links, the send affordance, primary buttons. If it's red, it's clickable. Nothing decorative is ever red.
- **Muted Gold (`{colors.accent-gold}` `#c9a227`)** signals "the Archive is present and active": the chat panel's border, the launcher's idle glow ring, the one-time discoverability pulse. It is not used for buttons or links — gold means presence, red means action.
- **Deep Umber (`{colors.launcher-fill}` `#2f2418`)** is the launcher icon's fill and the chat panel header band — the darkest surface in the system, anchoring the floating widget so it reads as an object sitting on top of the page rather than part of it.

Avoid: any blue, green, or "tech" color anywhere in the interface; flat corporate reds (oxblood only, never a bright/saturated red); more than one accent doing the same job.

## Typography

One serif family — `Georgia, "Times New Roman", serif` — carries every role in the system, at different sizes and line-heights for different jobs. This is a deliberate constraint: introducing a sans-serif "UI font" would immediately read as a bolted-on chat product rather than an archive.

- `{typography.display}` (28px) — the app's own title, "Federalist Research," and nothing else.
- `{typography.heading}` (18px) — section headings ("Browse Papers"), paper titles in the Paper Reader and Browse list.
- `{typography.reading}` (16px / 1.7 line-height) — full paper text in the Paper Reader. The generous line-height is deliberate: these are 18th-century sentences, and the reader needs room to breathe.
- `{typography.body}` (14px) — general page copy, subtitles, list metadata (author bylines).
- `{typography.chat}` (13px / 1.5 line-height) — everything inside the quill panel: questions, streamed answers, the input placeholder. Smaller than reading type because the panel is a corner-docked widget, not the primary reading surface.
- `{typography.caption}` (11px) — timestamps, the "streaming…" indicator, citation superscripts, the verification tag.

## Layout & Spacing

Scale: `{spacing.1}`–`{spacing.6}` (4/8/12/16/24/32px), plus named tokens for the two contexts that need more room: `{spacing.gutter}` (24px, the two-column Paper Reader gutter) and `{spacing.margin-desktop}` / `{spacing.margin-mobile}` for page edges.

The main content area (Browse Papers, Paper Reader) is a single reading column, centered, generous side margins — the archive is a book, not a data table. The floating quill widget is the one exception to single-column: it docks bottom-right, `{spacing.4}` (16px) from both edges, and floats above the page grid entirely rather than participating in it.

Inside the chat panel, spacing is tighter than the reading surface (`{spacing.2}`–`{spacing.3}`) because it is a compact utility surface, not the archive itself.

## Elevation & Depth

Depth is ink-tinted, not neutral-gray, and reserved for things genuinely floating above the page.

- The chat panel casts a diffused, warm-brown shadow (`rgba(58,47,36,0.35)`) — heavier than a typical card shadow, because it must read as *floating above* the page, not sitting flush within it.
- The launcher's idle state carries a soft gold halo (`0 0 0 6px rgba(201,162,39,0.25)`) rather than a shadow — presence, not elevation.
- Everything else in the reading surface (cards, paper rows, the browser-frame chrome) is nearly flat: a 1px hairline border does the separating work, not a shadow. Shadows are for the one floating object in the system; using them elsewhere would dilute that signal.

## Shapes

Corners are soft but not uniform. Reading surfaces (cards, the browser frame, paper rows) use `{rounded.md}` (8px) — enough to feel like a laid object, not a sharp digital rectangle.

The chat panel and its context chip use an intentional **dog-eared** asymmetry: `10px 10px 4px 10px` on the panel — three soft corners and one tight corner, bottom-left, pointing down toward the launcher it opens from. This is the single most distinctive shape decision in the system: it makes the panel read as a corner of the page peeling up, not a generic rounded-rectangle modal.

Chips are `{rounded.full}` (pill). The launcher itself is a full circle.

## Components

- **Launcher (quill)** — 56px circle, `{colors.launcher-fill}` radial fill, 🪶 glyph rotated −40° (as if just set down mid-stroke). Idle state carries the gold halo. First-visit-only: pulses once and auto-opens a tooltip ("Ask me about the Federalist Papers →"), then settles to icon-only permanently for that session.
- **Chat panel** — Docked bottom-right, 340px wide on desktop. Header band in `{colors.inverse-surface}` / `{colors.inverse-on-surface}` reading "🪶 Ask the Archive" with a collapse affordance. Body is `{colors.surface-panel}`. On mobile it becomes a full-screen sheet — no dog-ear, corners square, since it now owns the whole viewport.
- **Context chip** — Pill, `{colors.surface-chip}` fill, `{colors.accent-gold}` border, `📄 {Paper title}` label with a removable `✕`. Appears only when the user arrived from a Paper Reader page; absent for whole-archive questions.
- **Question bubble** — Right-aligned, `{colors.surface-user-bubble}`, tight bottom-right corner.
- **Answer bubble** — Left-aligned, `{colors.surface-raised}`, hairline border, tight bottom-left corner. Citations render inline as `{colors.surface-highlight}`-backed, dotted-underline `{colors.accent}` text with a numbered superscript.
- **Paper row (Browse Papers)** — Number, title (`{typography.heading}`), author byline (`{typography.body}`, `{colors.ink-secondary}`). Hairline divider only, no card shadow — this is a list, not a gallery.
- **Verification tag** — Quiet `{typography.caption}` text near the Paper Reader's title ("Source: Avalon Project ↗"), `{colors.ink-muted}`. Never inline per-passage, never in a drawer — a single quiet line of provenance.

## Do's and Don'ts

| Do | Don't |
|---|---|
| One serif family everywhere | Introduce a sans-serif "UI font" for the chat widget |
| Oxblood red only for things the reader can click | Use red for anything decorative or informational |
| Gold border/glow means "the Archive is present" | Use gold for buttons or link text |
| Shadow only on the floating quill panel | Add card shadows to reading-surface rows and paper cards |
| Dog-eared asymmetric corner on the chat panel | Round the chat panel's corners uniformly like a generic modal |
| Paper-white reserved for answer bubble + quoted passage | Use paper-white as a general card background |
