## Digest: Avalon textual provenance + fidelity check

### Part 1: Stated provenance
- Avalon's only project-level "about" document is the "Avalon Statement of Purpose" (linked from every page's footer) — describes general scope and inclusion policy, but no mention of source editions, transcription methodology, or transcriber/maintainer identity, generally or for the Federalist Papers specifically — source: https://avalon.law.yale.edu/about/purpose.asp, accessed: 2026-08-24, confidence: high
- Federalist Papers collection index page gives no editorial/source detail — source: https://avalon.law.yale.edu/subject_menus/major.asp, accessed: 2026-08-24, confidence: high
- Individual paper pages (Nos. 1, 10, 51 checked) carry no source-edition attribution or transcriber credit — only a generic "© 2008 Lillian Goldman Law Library" footer — source: direct fetch of fed01.asp, fed10.asp, fed51.asp, accessed: 2026-08-24, confidence: high
- No dedicated About/FAQ page exists beyond the Statement of Purpose; web search turned up only third-party descriptions (Wikipedia, AHA review, Yale Library catalog), none addressing editorial sourcing.

### Part 2: Fidelity comparison
#### Federalist No. 1 — verbatim match
Opening paragraph identical word-for-word between Avalon and LOC.

#### Federalist No. 10 — cosmetic differences only
Faction-definition sentence and "liberty is to faction what air is to fire" sentence byte-for-byte identical. Single discrepancy: Avalon renders "well-constructed" as "wellconstructed" (dropped hyphen, likely OCR artifact) — no wording/meaning change elsewhere sampled.

#### Federalist No. 51 — verbatim match
"Ambition must be made to counteract ambition" / "if men were angels" / "multiplicity of interests... multiplicity of sects" passages identical word-for-word.

### Overall verdict
Avalon publishes no provenance statement anywhere on its site — the original open question is NOT resolved by Avalon's own documentation. However, empirical spot-check across 3 papers / 8 compared passages found the body text essentially identical to LOC's documented Gutenberg-sourced text, with only one trivial, non-substantive discrepancy (a dropped hyphen). This strongly suggests Avalon draws on the same standard modernized-text lineage as LOC's Gutenberg edition rather than an independently OCR'd or divergent source. Recommendation: keep Avalon as ingestion source on textual-fidelity grounds (empirically verified), but don't rely on Avalon's own site as the "stated provenance" authority — the project's own citation UI can carry that burden instead (e.g., noting the edition lineage in the app rather than expecting Avalon to).

### Correction to prior report
LOC's own guide describes its text as "compiled for Project Gutenberg by scholars who drew on many available versions of the papers" — a softer claim than "a straight transcription of the 1788 McLean's Edition" as characterized in the original research.md. Corrected below.

### Could not find / open questions
- No Avalon page states which print edition (McLean's 1788, Gideon's 1818, or later) its transcription derives from, or who performed it.
- Only 3 of 85 papers / a handful of passages each were spot-checked; a larger sample would be needed to fully rule out scattered OCR-level artifacts like the one found in No. 10.
