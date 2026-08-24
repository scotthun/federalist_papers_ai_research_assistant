# UI Design

Clean academic/research aesthetic — explicitly not a generic ChatGPT-clone look. Emphasize documents, citations, source transparency, readability. Responsive.

## Main page

**Header:** "Federalist Research"
**Subtitle:** "Explore the Federalist Papers with source-grounded AI."

## Sections

**1. Ask the Archive** — a prominent question input. Example prompts shown to the user: "What arguments does Madison make about factions?", "What does Hamilton argue about the executive?", "How does Federalist No. 51 describe checks and balances?", "Which papers discuss the judiciary?"

**2. Answer** — displays: answer text, confidence indicator (derived per `decisions.md`, "Confidence tiering" — never LLM self-reported), citations, source passages.

**3. Related Papers** — papers related to the current question.

**4. Browse Papers** — all 85 papers, each row showing number, title, author(s) (CAP-1).

**5. Paper Reader** — paper number, title, author(s), complete text, cited passage(s) when accessed from an answer (CAP-6), and the verification source link (see below).

## Layout

Two-column research layout on desktop:
- **Left:** search / questions, answer
- **Right:** sources / citations / document context

## Verification link placement

See `decisions.md`, "Verification link placement" — a quiet tag near the paper title in the Paper Reader (e.g. "Source: Avalon Project ↗"), not inline per-passage, not in a drawer.

## Citation navigation

Every citation lets the user navigate to the relevant Federalist Paper and see: title, author(s), full text, and the cited passage highlighted or clearly identified if practical. If precise highlighting proves unnecessarily complicated, display the cited passage above/beside the full document instead — do not sacrifice project scope for sophisticated text highlighting.
