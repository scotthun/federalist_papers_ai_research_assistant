## Digest: Congress.gov / GovInfo.gov
### Claims
- Congress.gov (constitution.congress.gov) is a joint LOC/House/Senate/GPO service; GovInfo.gov is run by the U.S. Government Publishing Office — both authoritative for official government publications generally — source: https://www.govinfo.gov/, accessed: 2026-08-24, confidence: high, class: 1
- Neither site hosts the Federalist Papers as a standalone full-text product; both host "Constitution Annotated" (CONAN), a CRS-authored analytical volume that cites/quotes the Federalist Papers as supporting authority, organized by constitutional clause, not by 1-85 essay sequence — source: govinfo.gov/content/pkg/GPO-CONAN-2017/pdf/GPO-CONAN-2017.pdf and govinfo.gov/help/conan, pub_date: 2017, accessed: 2026-08-24, confidence: high, class: 3
- GovInfo's own "Other Resources" help page, when asked where to find the Federalist Papers, links out to the Library of Congress research guide rather than hosting the text itself — source: govinfo.gov/help/other-resources, accessed: 2026-08-24, confidence: high, class: 3
- Automated fetches of constitution.congress.gov (homepage and a deep /browse/essay/ page) returned HTTP 403 Forbidden — bot-detection/WAF beyond documented robots.txt — source: direct fetch, accessed: 2026-08-24, confidence: high, class: 2
- constitution.congress.gov's robots.txt only disallows search/query-string paths with a 2-second crawl-delay and publishes a sitemap.xml — documented policy is more permissive than the 403 actually encountered — source: constitution.congress.gov/robots.txt, accessed: 2026-08-24, confidence: high, class: 2
- GovInfo's search UI is a client-side JS app; plain HTTP fetch returns an empty shell (a dedicated api.govinfo.gov exists but untested) — source: direct fetch, accessed: 2026-08-24, confidence: medium, class: 2
- Wayback "closest to earliest" capture: congress.gov 2001-02-02, govinfo.gov 2016-02-18 (consistent with GovInfo's 2016 relaunch from FDsys) — source: web.archive.org Wayback Availability API, accessed: 2026-08-24, confidence: medium, class: 4

### Leads
- guides.loc.gov/federalist-papers (LOC family, distinct domain) already covered by the LOC/NARA digest.
- api.govinfo.gov bulk-data/API service untested — would still only surface CONAN annotation documents, not standalone Federalist text.

### Could not find / open questions
- No GovInfo package dedicated to "The Federalist" as a standalone 85-paper corpus — only CONAN annotation volumes that cite them.
- Whether the 403s reflect a blanket bot-block vs. a request-signature-specific block — not independently verified with an alternate client.

## Digest: Avalon Project (cross-check, independent agent)
### Claims
- Independently confirms: Lillian Goldman Law Library, Yale Law School; listed by LOC's own Federalist Papers guide as a credible external source — source: guides.loc.gov/federalist-papers/external-websites + Avalon footer, accessed: 2026-08-24, confidence: high, class: 1
- Founded 1996, "one of the older digital text projects on the internet" — source: web search aggregation, accessed: 2026-08-24, confidence: medium, class: 1
- Federalist No. 1 fetch: plain HTML (.asp), complete text on one non-paginated page, clear title/author metadata, no auth wall — source: direct fetch, accessed: 2026-08-24, confidence: high, class: 2
- URL pattern confirmed independently: `avalon.law.yale.edu/18th_century/fed{NN}.asp`, zero-padded 01-85 — source: direct fetch + index page, accessed: 2026-08-24, confidence: high, class: 2
- Index page lists all 85 papers as numbered links — source: direct fetch, accessed: 2026-08-24, confidence: high, class: 3
- Wayback earliest capture of fed01.asp: 2008-10-23, identical path to live 2026 URL — ~18 years confirmed stable URL structure — source: web.archive.org Wayback Availability API, accessed: 2026-08-24, confidence: high, class: 4

### Leads
- Minor path-casing inconsistency observed in raw search results (/18th_century/ vs /18th_Century/) — worth a case-sensitivity check before scripting, though server appears to resolve both.

### Could not find / open questions
- No Wayback capture found between stated 1996 founding and earliest fed01.asp capture (2008) — founding date rests on secondary sources.
- Rate-limiting/robots.txt behavior under sustained bulk fetching (all 85 pages) untested — only single-page fetches verified.
