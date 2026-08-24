---
name: 'Stack Version Verification Review'
type: review
reviews: ../ARCHITECTURE-SPINE.md
status: complete
created: '2026-08-24'
---

# Review: Stack Table Version Verification

Scope: resolve every `*unverified*` row in ARCHITECTURE-SPINE.md's Stack table via live web
research (not training-data recall), confirm each technology still exists and is a reasonable
fit for a NestJS + Nx + Postgres/pgvector RAG app, and specifically confirm what Postgres version
and pgvector version Neon supports today, from Neon's own docs. All lookups below were run
2026-08-24 via web search + direct fetch of npm registry / GitHub / vendor docs.

## Verdict

Every previously-`unverified` row can now be resolved with a current version number, and none of
the seven technologies are dead-ends or a poor fit for this architecture — but two rows carry
material nuance the Stack table's single-cell format will hide unless called out explicitly:
TypeORM just emerged from a multi-year "is this dead?" period (now resolved, but worth a footnote
on *why* it was flagged), and Neon does not serve one uniform pgvector version — it serves
**0.8.0 on Postgres 14–17** and **0.8.6 only on Postgres 18**, which is a real decision input for
AD-1/AD-3, not a footnote.

## Findings, technology by technology

### Next.js — 16.3.2

- Latest published version on the npm registry (`registry.npmjs.org/next/latest`) is **16.3.2**.
- Corroborated by web search: Next.js 16 is in Active LTS; Next.js 15 is in Maintenance LTS until
  October 2026. A security release for 16.3/15.5 was scheduled for 2026-08-26.
- Still exists, still the dominant React meta-framework, and Vercel (the chosen host, AD-1) is
  its first-party vendor — strong fit, no concerns.
- Sources: [npm registry](https://registry.npmjs.org/next/latest), [Next.js May 2026 security release — Vercel changelog](https://vercel.com/changelog/next-js-may-2026-security-release), [HeroDevs Next.js EOL timeline](https://www.herodevs.com/blog-posts/nextjs-eol-dates-version-support-timeline)

### NestJS — 11.2.1 (`@nestjs/core`)

- Latest published version on the npm registry is **11.2.1** (`@nestjs/cli` at 11.0.24).
- Still exists, still actively published, no successor framework has displaced it. Fits the
  spine's module/controller/service layering (Design Paradigm section) directly — it's the
  framework the paradigm is named after.
- Vercel's **zero-configuration native NestJS support** is independently confirmed here too (not
  just taking the spine's word for it): Vercel's own changelog entry "Zero-configuration support
  for NestJS" describes exactly the AD-1 claim (deploys as a single Vercel Function on Fluid
  compute, auto-scales, no manual server code needed). That changelog entry is dated **2025-10-17**
  — earlier than the spine's "confirmed 2026-07-06" annotation, which is fine (2026-07-06 is
  presumably when the *previous* research pass checked it, not when the feature shipped) but worth
  noting the underlying feature has been stable for close to a year, not newly shipped.
- Sources: [npm registry](https://registry.npmjs.org/@nestjs/core/latest), [Vercel: Zero-configuration support for NestJS](https://vercel.com/changelog/zero-configuration-support-for-nestjs), [Vercel NestJS docs](https://vercel.com/docs/frameworks/backend/nestjs)

### TypeORM — 1.1.0

- Latest published version on the npm registry is **1.1.0** (published ~July 2026).
- **Notable and worth flagging explicitly**: TypeORM reached **1.0.0 for the first time in its
  ~decade of existence around June 2026** (InfoQ: "TypeORM Reaches 1.0 after Nearly a Decade,
  Signalling Renewed Maintenance," 2026-06-05). Before that release, there was a real, visible
  community concern (recurring "is TypeORM dead/abandoned?" threads) about whether the project
  was still maintained — this is exactly the kind of fact a training-data-only answer would have
  missed or gotten wrong, since a cutoff before mid-2026 would only know TypeORM as a perpetually-
  pre-1.0, maintenance-uncertain project. As of now it's a live counter-signal: 1.0 removed long-
  deprecated APIs, requires Node 20+/ES2023, and is described as actively maintained again.
- **Fit for this use case**: TypeORM has native `vector` column type support for Postgres via
  pgvector (added during the 0.3.x cycle, confirmed still present in 1.x) — `@Column('vector', {
  length: N })` with a `number[]` — so `libs/database`'s repository layer (AD-6) can model
  `DocumentChunk.embedding` natively rather than dropping to raw SQL. This directly supports the
  architecture's plan to have `database` own the pgvector schema.
- Residual open item (not resolved by this pass, flag for implementation time): TypeORM's vector
  support does not yet cover `sparsevec`; only `vector`/`halfvec`/`bit` are supported. Not a
  blocker for this project's flat-embedding use case, just noted.
- Sources: [npm registry](https://registry.npmjs.org/typeorm/latest), [InfoQ: TypeORM Reaches 1.0](https://www.infoq.com/news/2026/06/typeorm-1-released/), [TypeORM 1.0 blog post](https://typeorm.io/blog/typeorm-1-0/), [typeorm/typeorm PGVector support issue #11485](https://github.com/typeorm/typeorm/issues/11485), [pgvector-node typeorm test](https://github.com/pgvector/pgvector-node/blob/master/tests/typeorm.test.mjs)

### PostgreSQL — 18.6 (current stable major: 18)

- Current stable major version is **PostgreSQL 18** (first released 2025-09-25), current minor
  **18.6** (released 2026-08-13, per postgresql.org's own release announcement).
- Currently supported majors and their EOL: 18 (EOL 2030-11-14), 17.11 (EOL 2029-11-08), 16.15
  (EOL 2028-11-09), 15.19 (EOL 2027-11-11), 14.24 (**EOL 2026-11-12** — i.e., PG14 goes EOL in
  under three months from today; relevant if anyone considers pinning to 14).
  PostgreSQL 19 is in beta, expected final release September/October 2026.
- Still exists (obviously) and is precisely what pgvector and Neon are built on — no fit concerns.
- Sources: [PostgreSQL Versioning Policy](https://www.postgresql.org/support/versioning/), [PostgreSQL 18.4/17.10/16.14/15.18/14.23 release announcement](https://www.postgresql.org/about/news/postgresql-184-1710-1614-1518-and-1423-released-3297/)

### pgvector — 0.8.6 (latest tagged release; 0.8.7 unreleased)

- Confirmed via GitHub tags API (`api.github.com/repos/pgvector/pgvector/tags`): the most recent
  tag is **v0.8.6**. (Note: the GitHub "Releases" API/page returns nothing for this repo — pgvector
  ships via git tags, not GitHub Releases — so anyone checking only the Releases page, as an
  earlier fetch in this session did, will wrongly conclude "no releases exist." Tags are the
  correct signal here.)
- pgvector's own `CHANGELOG.md` on `master` shows a **0.8.7 entry marked "(unreleased)"** with one
  pending fix, confirming 0.8.6 is indeed the latest *shipped* version as of today.
- Still exists, still the standard vector-search extension for Postgres, actively released — good
  fit, no concerns about the extension itself.
- Sources: [GitHub tags API](https://api.github.com/repos/pgvector/pgvector/tags), [pgvector CHANGELOG.md](https://raw.githubusercontent.com/pgvector/pgvector/master/CHANGELOG.md), [pgvector/pgvector repo](https://github.com/pgvector/pgvector)

### LangChain.js — 1.5.x (`langchain` 1.5.10, `@langchain/core` 1.2.8)

- Latest published version of the `langchain` package on the npm registry is **1.5.10**;
  `@langchain/core` is at **1.2.8**.
- LangChain's own versioning docs confirm the **1.x line is current**, with the legacy **0.3.x**
  (JS) / LangGraph 0.4 line in maintenance-only mode until **December 2026**. This matters: if
  anyone scaffolds this project from an older tutorial/example, it likely targets the 0.3.x API,
  which is a different (and soon-unsupported) surface from what should actually be installed.
- Still exists, still actively released (multiple packages published within the last 24 hours of
  this check), and fits the RAG orchestration role implied by `libs/ai` / `libs/retrieval` — though
  note the spine itself doesn't currently commit to using LangChain.js for anything specific
  beyond naming it in the Stack table; worth double-checking during implementation whether it's
  actually load-bearing (e.g., for a text splitter or provider abstraction) or listed speculatively.
- Sources: [npm registry](https://registry.npmjs.org/langchain/latest), [LangChain.js versioning docs](https://docs.langchain.com/oss/javascript/versioning), [langchain on npm](https://www.npmjs.com/package/langchain)

### Zod — 4.4.3 (stable); 4.5.0-canary also exists

- Latest published **stable** version on the npm registry is **4.4.3**. A `4.5.0-canary...`
  prerelease also exists (published 2026-08-20) but is not the version to depend on.
- Zod v4 (not v3) is the current major line — relevant since a lot of existing tutorial code and
  training-data-era knowledge defaults to v3 APIs (`z.string()` behavior, error customization, and
  `.parse`/`.safeParse` are compatible, but v4 changed several APIs, e.g. error map / `.default()`
  edge cases). Worth a callout during implementation, not a blocker.
- Still exists, still the standard runtime-validation library for TS, and fits AD-9 directly
  (single source of truth for the `Answer`/`Citation` schema, shared between `apps/web` and
  `apps/api`) — no concerns.
- Sources: [npm registry](https://registry.npmjs.org/zod/latest), [Zod v4 release notes](https://zod.dev/v4), [Zod versioning](https://zod.dev/v4/versioning)

### Neon — Postgres version + pgvector version actually supported (the specific ask)

This is the one the task called out by name, so treating it as its own item rather than folding
it into the PostgreSQL/pgvector rows above.

- **Postgres majors Neon supports today**: per Neon's own docs, "Neon currently supports Postgres
  14, 15, 16, 17, and 18." You choose the major version at project-creation time.
- **pgvector version Neon actually ships, per Postgres major** (per Neon's Postgres Extensions
  page, which is Neon's own source of truth for this — not a third party): 

  | Neon Postgres version | pgvector version installed |
  | --- | --- |
  | 14 | 0.8.0 |
  | 15 | 0.8.0 |
  | 16 | 0.8.0 |
  | 17 | 0.8.0 |
  | 18 | 0.8.6 |

  This is a genuinely important, non-obvious fact for this project: **Neon does not give you the
  latest pgvector (0.8.6) unless you provision the project on Postgres 18.** If a Neon project
  gets created on Postgres 16 or 17 (both very plausible defaults/choices), it is pinned to
  pgvector **0.8.0**, not 0.8.6 — a meaningfully older extension version (0.8.0 shipped in early
  2025; 0.8.1–0.8.6 span roughly a year of incremental fixes/features). Neon also documents that
  you can install one version of pgvector behind the current supported one, but nothing newer —
  so this isn't something `CREATE EXTENSION` can route around.
  - **Recommendation for AD-1/AD-3**: if this project wants the newest pgvector on Neon, the
    architecture should specify **Postgres 18** as the Neon project's Postgres major version
    explicitly, rather than leaving it implicit. This is a one-line addition to AD-1 or the Stack
    table, not a new decision requiring elicitation — flagging it as a gap rather than resolving
    it unilaterally, since "which Postgres major to provision" reads like exactly the kind of
    concrete, cheap-to-state decision the spine already makes elsewhere (e.g., AD-3's pooled-vs-
    direct endpoint rule).
- The spine's existing separate claim — "Neon: Free tier confirmed permanent (not trial), pgvector
  included, as of 2026-08 research" — checks out independently in this pass too: Neon's free tier
  is confirmed permanent (0.5 GB storage, 100 compute-hours/month, no credit card, commercial use
  allowed), and pgvector is available on the free plan with no add-on.
- Sources: [Neon: Postgres extensions](https://neon.com/docs/extensions/pg-extensions), [Neon: the pgvector extension](https://neon.com/docs/extensions/pgvector), [Neon Postgres version support](https://neon.com/docs/postgresql/postgres-version-policy)

## Recommended Stack table update

| Name | Version | Notes |
| --- | --- | --- |
| Next.js | 16.3.2 | current stable, npm registry, 2026-08-24 |
| NestJS | 11.2.1 (`@nestjs/core`) | current stable, npm registry, 2026-08-24 |
| TypeORM | 1.1.0 | reached 1.0 June 2026 after ~decade at 0.3.x; native pgvector `vector` column support |
| PostgreSQL | 18.6 (current major: 18) | postgresql.org, 2026-08-24; Neon supports 14–18 |
| pgvector | 0.8.6 (latest tag; 0.8.7 unreleased) | **Neon ships 0.8.6 only on Postgres 18; 0.8.0 on PG 14–17** — see Neon finding above |
| LangChain.js | 1.5.10 (`langchain`) / 1.2.8 (`@langchain/core`) | 1.x is current; legacy 0.3.x in maintenance-only until Dec 2026 |
| Zod | 4.4.3 | v4 is current major, not v3 |
| Vercel (hosting) | — | native zero-config NestJS support independently reconfirmed (Vercel changelog); underlying feature dates to 2025-10-17 |
| Neon (Postgres host) | — | free tier permanence + pgvector inclusion reconfirmed; **pgvector version served depends on chosen Postgres major — needs explicit major-version pick, see above** |

## What was NOT flagged

Everything else in the spine's Stack table read as appropriately hedged already (the spine itself
marked all seven rows `unverified`, which was accurate — none of them asserted a specific version
number as fact prior to this pass). The two rows that *were* already asserted as fact (Vercel
native NestJS support, Neon free-tier permanence) both check out against independent sources in
this pass; no correction needed there, only the minor date nuance noted under NestJS above.
