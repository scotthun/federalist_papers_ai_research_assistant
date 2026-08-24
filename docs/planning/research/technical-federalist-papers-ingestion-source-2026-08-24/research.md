---
title: 'technical research: Federalist Papers ingestion source'
type: 'technical'
topic: 'Federalist Papers ingestion source'
decision: 'Which single source to standardize on for both (a) ingesting the 85 Federalist Papers and (b) the per-paper verification link shown to end users'
source: 'run'
status: complete
preset: 'standard'
validation: 'normal'
created: '2026-08-24'
updated: '2026-08-24'
verified_claims: 7
unverified_claims: 0
disputed_claims: 1
---

# technical research: Federalist Papers ingestion source

**Decision this research serves:** Which single source to standardize on for both (a) ingesting the 85 Federalist Papers and (b) the per-paper verification link shown to end users.

## Executive Summary

**Pick the Avalon Project** (Yale Law School, Lillian Goldman Law Library) as the single ingestion + citation source for all 85 Federalist Papers.

Three findings drive this: (1) Avalon is the only candidate that actually hosts all 85 papers as plain, uniform HTML at a predictable URL (`avalon.law.yale.edu/18th_century/fed{NN}.asp`), confirmed by fetching Nos. 1, 10, and 85 directly [1][2]; (2) its current URL scheme has been independently verified stable for ~18 years — Wayback Machine shows the same path resolving continuously since 2008-10-23 [3][4] — the strongest longevity evidence of any candidate; (3) it fetches cleanly with no auth wall or JS-rendering, unlike Founders Online (National Archives), which resisted automated fetching on 6/6 attempts this run [5]. The two official U.S. government candidates that seemed like obvious first choices — Congress.gov and GovInfo.gov — don't actually clear the bar: neither hosts the Federalist Papers as a standalone 85-essay corpus at all, only citations to them inside an unrelated document (Constitution Annotated) [6].

**Biggest caveat (investigated, resolved with a residual gap):** A follow-up check confirmed Avalon publishes no provenance statement anywhere on its site — no named editor, source edition, or transcriber credit, on its Statement of Purpose, its Federalist Papers index, or the individual paper pages [12]. However, an empirical spot-check of 3 papers (Nos. 1, 10, 51) across 8 passages found Avalon's text essentially word-for-word identical to LOC's documented text, with a single trivial discrepancy (a dropped hyphen in No. 10, likely an OCR artifact) [13]. That's strong practical evidence Avalon draws on the same standard modernized-text lineage as LOC's Gutenberg-sourced edition — **the pick stands, no pivot warranted** — but Avalon itself shouldn't be treated as the "documented provenance" authority; the app's own citation UI should carry that context rather than assuming Avalon states it.

## Requirements Frame

**Hard gates** (fail either → out of the running):
- Must host the full text of all 85 Federalist Papers (not a subset, not just excerpts/citations)
- Must have stable, durable per-paper URLs usable as both an ingestion target and a public-facing citation link

**Weighted criteria** (all four requested by the project owner, weighted roughly equally — this is a portfolio project, not an enterprise procurement, so no single criterion dominates):
1. Credibility/authority — would a historian trust this as a primary-source citation?
2. Ingestion friendliness — plain HTML/text, consistent structure, no auth wall, no aggressive rate-limiting, scriptable without heavy per-page special-casing
3. Completeness — all 85 papers actually present and verifiable via an index
4. Link/URL longevity — site age, and whether its URL structure has stayed stable over time (added per project owner's explicit ask: avoid broken links down the road)

## Candidate Screen

| Candidate | Screened? | Why |
|---|---|---|
| Avalon Project (Yale Law School) | ✅ Advanced | Clears both hard gates |
| Library of Congress (research guide) | ✅ Advanced | Clears both hard gates, weaker on independent longevity evidence |
| National Archives / Founders Online | ✅ Advanced | Clears completeness gate; ingestion-friendliness gate is contested |
| Congress.gov / GovInfo.gov | ❌ Cut | **Fails the completeness hard gate** — hosts citations to the Federalist Papers inside Constitution Annotated, not the 85 papers themselves [6] |
| Project Gutenberg | Considered, not advanced | Long-lived and stable, but not an academic/government archive — fails the "trusted archive for a verification link" spirit of the requirement, and it's the *upstream source* LOC's own guide already re-hosts [7] |

Three finalists carried into scoring: **Avalon Project**, **Library of Congress**, **Founders Online**.

## Evidence Per Criterion

| Criterion | Avalon Project | Library of Congress | Founders Online (NARA) |
|---|---|---|---|
| **Credibility/authority** | Yale Law School institutional archive; cited by LOC's own guide as a trusted external source [1][2] | Named LOC staff-maintained guide; but text itself is third-party (Gutenberg), not LOC-native [7][8] | Backed by NHPRC + peer-reviewed scholarly documentary editions (242 print volumes) — **strongest academic pedigree of the three** [9] |
| **Ingestion friendliness** | Plain HTML, uniform template, no auth wall, fetched cleanly on every attempt [1][2] | Plain HTML, no auth wall, fetched cleanly [7][8] | **Resisted every direct fetch this run** (6/6 pages returned empty content) — likely JS-rendered or bot-resistant; a bulk metadata JSON endpoint exists but wasn't confirmed accessible either [5][10] |
| **Completeness** | All 85 confirmed via a single index page listing every paper 1–85 [2] | All 85 confirmed across 9 grouped pages (text-1-10 … text-81-85) [8] | Full range (spot-checked across ~18 paper numbers) inferred present, but **no single index/TOC page was found** — completeness rests on scattered search hits, not an enumerated list [5] |
| **Link/URL longevity** | **Same URL path confirmed live since 2008-10-23** (499 Wayback captures, unbroken) — ~18 years [3][4] | URL structure only independently confirmed back to **2022** via a single Perma.cc capture; Wayback itself couldn't be queried for this domain this run [11] | Site operating since 2013 (~13 years) per NARA's own announcement, but **no independent Wayback confirmation of URL stability** — longevity rests on a self-reported launch date only [9] |

**Two-source check** (per the research method's rule for decisive cells): the Avalon longevity and structure claims were independently confirmed by *two separate research agents* working in parallel with no shared context — both landed on the same URL pattern and the same 2008 Wayback anchor date [3][4]. No other candidate's decisive claim got independent double-coverage.

## Cross-Candidate Insight

The three finalists split cleanly along an axis the individual criteria don't show on their own: **academic pedigree of the source text vs. operational reliability of the delivery mechanism.** Founders Online has the best-credentialed *text* (peer-reviewed critical editions) but the least reliable *delivery* (fails to fetch cleanly, no index). Avalon has the most reliable *delivery* (stable, scriptable, complete) with a *good-but-less-formally-credentialed* provenance story. For a project whose stated principle is "prefer deterministic application logic" and whose owner explicitly ranked link stability as a priority, that tradeoff resolves toward Avalon — a project that can't reliably ingest a source doesn't get to benefit from that source's superior pedigree.

## Contrary Evidence (strongest argument against the pick)

Founders Online's peer-reviewed, NARA-backed provenance is a genuinely stronger citation than a law-school-hosted text of undocumented editorial provenance — if a skeptical reader's actual question is "is this the scholarly-critical-edition text," Avalon doesn't have as clean an answer as Founders Online does. The counter is practical, not evidentiary: Founders Online's fetch resistance this run (6/6 failed) makes it a real engineering risk for both ingestion *and* the live outbound verification link (a broken/slow-loading link at the moment a skeptical reader clicks "verify this" undermines the exact trust the link exists to build).

## Recommendation

**Primary:** Standardize on the **Avalon Project** (`avalon.law.yale.edu/18th_century/fed{NN}.asp`) for both document ingestion and the per-paper "verify this" outbound link. Confidence: high on ingestion-friendliness and longevity (independently double-sourced); medium on the "is this the definitive scholarly edition" question (single-sourced, not fully resolved).

**Runner-up and when it wins instead:** If, during Phase 3 implementation, a working programmatic path into Founders Online's bulk metadata endpoint (`founders.archives.gov/Metadata/`) turns out to be reliable (the third-party `Rohrym/Founders_API` project suggests one exists [10]), Founders Online becomes the stronger pick on pure academic credibility — worth a quick spike before committing, if the extra rigor matters more than the extra engineering effort.

**Reversibility hedge:** Keep `sourceUrl` and the ingestion source as separate, explicitly named config in the ingestion pipeline (not hard-coded inline) — per the architecture discussion already had, this is cheap regardless of which source is picked, and means switching later (e.g., to Founders Online once its API is validated) doesn't require touching the parser's call sites, only its implementation.

## Open Questions

- ~~**Avalon's text provenance**~~ — **Resolved via Deepen (2026-08-24):** Avalon states no provenance anywhere on its site [12], but an empirical fidelity check (3 papers, 8 passages) found its text essentially identical to LOC's documented Gutenberg-sourced text, with only one trivial OCR-level discrepancy [13]. No pivot needed. Residual: only 3 of 85 papers were spot-checked — a larger sample would fully rule out scattered minor artifacts, but nothing found so far rises above cosmetic.
- **Founders Online bulk API viability** — the `Metadata/` JSON endpoint and the third-party `Rohrym/Founders_API` reference implementation weren't tested directly this run. *(Route: a short technical spike if you want to keep Founders Online as a live option rather than a documented runner-up.)*
- **Avalon rate-limiting under bulk fetch** — only single-page fetches were tested; scripting all 85 pages in sequence wasn't verified against any throttling. *(Route: build the ingestion script with a small per-request delay regardless, and watch for 429s in Phase 3 — cheap insurance, doesn't need pre-research.)*

## Source Appendix

| # | Claim/finding it supports | Publisher | Pub. date | Accessed | Confidence |
|---|---|---|---|---|---|
| [1] | Avalon Project is a Yale Law School institutional archive, listed by LOC as a trusted external source | [Yale University Library / LOC Research Guides](https://guides.loc.gov/federalist-papers/external-websites) | undated | 2026-08-24 | high |
| [2] | Avalon hosts all 85 papers as plain HTML at a predictable URL pattern, confirmed by direct fetch + index page | [Avalon Project](https://avalon.law.yale.edu/subject_menus/fed.asp) | undated | 2026-08-24 | high |
| [3] | Avalon's fed01.asp URL live and unchanged since 2008-10-23 (499 Wayback captures) | Wayback Machine CDX API | n/a | 2026-08-24 | high |
| [4] | Independent second-agent confirmation of [3] | Wayback Machine Availability API | n/a | 2026-08-24 | high |
| [5] | Founders Online resisted direct fetch on 6/6 attempts; no single index page found | [Founders Online](https://founders.archives.gov/) (direct tool observation) | n/a | 2026-08-24 | medium |
| [6] | Congress.gov/GovInfo.gov host Constitution Annotated (citing the Federalist Papers), not the papers themselves | [GovInfo — CONAN](https://www.govinfo.gov/help/conan) | 2017 | 2026-08-24 | high |
| [7] | LOC guide's Federalist text was "compiled for Project Gutenberg by scholars who drew on many available versions of the papers" (corrected 2026-08-24 Deepen — not a single-edition McLean's-1788 transcription as originally characterized) | [LOC Research Guides](https://guides.loc.gov/federalist-papers/full-text) | undated | 2026-08-24 | high |
| [12] | Avalon publishes no provenance/source-edition statement anywhere on its site (Statement of Purpose, collection index, 3 sampled paper pages all checked) | [Avalon Project — Statement of Purpose](https://avalon.law.yale.edu/about/purpose.asp) | undated | 2026-08-24 | high |
| [13] | Empirical fidelity check: 3 papers (Nos. 1, 10, 51), 8 passages, essentially verbatim match against LOC's text — one trivial non-substantive discrepancy | Direct fetch comparison, Avalon vs. LOC | n/a | 2026-08-24 | high |
| [8] | LOC guide hosts all 85 papers across 9 grouped pages | [LOC Research Guides](https://guides.loc.gov/federalist-papers/text-81-85) | undated | 2026-08-24 | high |
| [9] | Founders Online launched 2013-06-13, backed by NHPRC + UVA Press, drawn from 242-volume peer-reviewed editions | [National Archives press release](https://www.archives.gov/press/press-releases/2013/nr13-103) | 2013-06-13 | 2026-08-24 | high |
| [10] | Founders Online bulk metadata endpoint exists; third-party project consumes it programmatically | [GitHub — Rohrym/Founders_API](https://github.com/Rohrym/Founders_API) | undated | 2026-08-24 | medium |
| [11] | LOC guide URL structure confirmed stable back to 2022 via a single Perma.cc capture | [Perma.cc via Internet Archive](https://archive.org/details/perma_cc_T2SQ-VQ89) | 2022-03-08 | 2026-08-24 | medium |

## Staleness Map

| Claim | Class | Re-check by |
|---|---|---|
| Avalon page structure / no auth wall (ingestion-friendliness snapshot) | versions_compat | **2026-09-01** |
| Founders Online fetch resistance | versions_compat | **2026-09-01** |
| Congress.gov/GovInfo.gov completeness gap | versions_compat | **2026-09-01** |
| Avalon URL longevity since 2008 | patterns | 2028-08-01 |
| LOC text provenance (Gutenberg) | patterns | 2028-08-01 |
| LOC URL stability since 2022 (disputed — single-sourced) | patterns | 2028-08-01 |

**Earliest re-check: 2026-09-01.** The ingestion-friendliness claims (page structure, fetch behavior) are what actually drives the Phase 3 parser — re-verify those specific pages immediately before writing the ingestion script, not from this report alone, since a site redesign between now and then would invalidate the parser design, not just the report.
