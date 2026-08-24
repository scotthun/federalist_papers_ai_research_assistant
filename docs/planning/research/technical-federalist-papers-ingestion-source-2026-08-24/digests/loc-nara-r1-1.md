## Digest: Library of Congress
### Claims
- guides.loc.gov/federalist-papers is an official LOC "Research Guide" (LibGuides), authored by named LOC staff (Ken Drexler, Robert Brammer; edited by Barbara Bavis, Law Library of Congress) — source: https://guides.loc.gov/federalist-papers, pub_date: "Last Updated: Mar 30, 2026", accessed: 2026-08-24, confidence: high, class: 1
- Full text embedded as plain HTML across nine grouped pages: text-1-10, text-11-20, ... text-81-85; no PDF, no auth wall — source: https://guides.loc.gov/federalist-papers/text-1-10, accessed: 2026-08-24, confidence: high, class: 2
- Guide states its text "was obtained from the e-text archives of Project Gutenberg" (third-party transcription, not LOC-native); individual pages cite original print source as "McLEAN'S Edition, New York" (1788) — source: guides.loc.gov/federalist-papers and .../text-81-85, accessed: 2026-08-24, confidence: high, class: 1 (authority nuance) / 2
- "Full Text" landing page links all nine groupings covering all 85 essays; text-81-85 verified to contain Nos. 81-85 in full — source: guides.loc.gov/federalist-papers/full-text and .../text-81-85, accessed: 2026-08-24, confidence: high, class: 3
- A Perma.cc capture of the guide's text-21-30 subpage dated 2022-03-08 confirms this URL structure has been stable since at least that date — source: archive.org/details/perma_cc_T2SQ-VQ89, accessed: 2026-08-24, confidence: medium, class: 4

### Leads
- guides.loc.gov/federalist-papers/external-websites and /digital-resources may point to other LOC digital collections (possibly scanned manuscript/newspaper images) — not fetched.
- archive.org hosts scanned print volumes of "The Federalist" (e.g. archive.org/details/federalistcollec00hami) as an image-level cross-check.
- Unverified whether Gutenberg-derived text has known transcription/OCR discrepancies vs. the McLean's Edition print.

### Could not find / open questions
- Could not get a direct Wayback Machine earliest-capture date for guides.loc.gov/federalist-papers (tool blocked from fetching web.archive.org this session); only indirect Perma.cc evidence (2022) obtained.
- No visibility into guides.loc.gov's URL history before 2022, or whether LibGuides slugs have ever been reorganized.
- No confirmation of rate-limit policy or robots.txt for guides.loc.gov.

## Digest: National Archives / Founders Online
### Claims
- Founders Online is operated by NARA's National Historical Publications and Records Commission (NHPRC) in partnership with University of Virginia Press, launched with congressional funding — source: https://www.archives.gov/press/press-releases/2013/nr13-103, pub_date: 2013-06-13, accessed: 2026-08-24, confidence: high, class: 1
- Content drawn from peer-reviewed scholarly documentary editions (e.g. "The Papers of Alexander Hamilton," "The Papers of James Madison"), originally 242 print volumes — source: same press release, accessed: 2026-08-24, confidence: high, class: 1
- Individual papers addressable at founders.archives.gov/documents/{Collection}/{DocumentID}, e.g. .../Hamilton/01-04-02-0152 (No. 1); IDs non-sequential relative to paper number; No. 62 (disputed authorship) appears at two different URLs under both Hamilton and Madison collections — source: WebSearch snippets, accessed: 2026-08-24, confidence: high, class: 2
- Direct fetch attempts against six different founders.archives.gov pages all returned empty/no extractable content, while equivalent guides.loc.gov fetches succeeded every time — suggests JS-rendering or bot-resistance, root cause unconfirmed — source: direct tool observation, accessed: 2026-08-24, confidence: medium, class: 2
- A bulk metadata endpoint exists (founders.archives.gov/Metadata/, founders-online-metadata.json); a third-party open-source project (github.com/Rohrym/Founders_API) documents pulling structured data programmatically, noting ~5-hour runtime for a full pull — source: GitHub README, accessed: 2026-08-24, confidence: medium, class: 2
- Pages located spanning the full numeric range (Nos. 1, 10, 11, 15, 20, 28, 45, 51, 54, 55, 62, 63, 68, 69, 70, 78, 84, 85) plus an "Introductory Note" page, indicating the complete set of 85 is present — source: WebSearch results, accessed: 2026-08-24, confidence: medium (no single index/TOC page loaded), class: 3
- Founders Online publicly launched 2013-06-13 per NARA press release — ~13 years of continuous operation under NARA as of 2026 — source: same press release, accessed: 2026-08-24, confidence: high, class: 4

### Leads
- founders.archives.gov/Metadata/ bulk JSON dump — could not render via fetch tool this session, referenced by a working third-party consumer; worth direct investigation as structured-data path superior to HTML scraping.
- National Archives Catalog API (archives.gov/developer, search.archives.gov) as alternative/complementary programmatic access.
- GitHub Rohrym/Founders_API as a working reference implementation.

### Could not find / open questions
- Could not visually confirm founders.archives.gov page structure (plain HTML vs JS-rendered SPA) via direct fetch — every attempt returned blank content; structure findings are inferred, not directly observed.
- No confirmation of rate-limit policy, robots.txt, or terms of use for automated access.
- No single canonical index-of-85-papers page located/confirmed directly.
- No direct Wayback Machine confirmation of URL-structure stability over time (tool blocked from web.archive.org this session); longevity rests on NARA's self-reported 2013 launch date only.
