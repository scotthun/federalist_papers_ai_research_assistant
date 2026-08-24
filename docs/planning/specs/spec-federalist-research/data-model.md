# Data Model

## Entities

**FederalistPaper**
- id
- paperNumber
- title
- publicationDate (if available)
- sourceUrl — **required, not optional** (links to the Avalon Project page for independent verification; see `decisions.md`)
- fullText
- createdAt
- updatedAt

**Author**
- id
- name
- createdAt
- updatedAt

Kept deliberately minimal — no bio/portrait/birth-year fields, since no "About the Authors" feature is in scope today. The entity exists so that decision is cheap to make later (add columns here) rather than requiring a schema redesign.

**DocumentChunk**
- id
- paperId
- chunkIndex
- content
- embedding (pgvector column; embedding model configurable, never hard-coded into the domain layer)
- section/heading (if available)
- pageNumber (if available)
- metadata (JSON, if useful)
- createdAt

`chunkId` is ephemeral — see `decisions.md` ("Chunk ID lifetime").

## Relationships

- `FederalistPaper` 1 → many `DocumentChunk`
- `FederalistPaper` many ↔ many `Author`

## Authorship modeling

Authorship is many-to-many, not a string column, because several papers have disputed or jointly-credited authorship (Nos. 18–20: Hamilton/Madison collaboration; Nos. 62–63: long-disputed between the two). A single string forces either an arbitrary pick or an unqueryable value like `"Hamilton or Madison"`.

Implementation: a plain TypeORM `@ManyToMany` with an auto-managed join table (e.g. `federalist_paper_authors`) — no separate join-entity class, since the relationship carries no extra data (no role, no ordering). Chosen over a simpler `author: string[]` array column specifically so authorship has a proper home if it ever grows attached metadata (a deliberate trade of one extra table/join for correctness, not the cheapest possible option).

## Ingestion chunking strategy

See `stack.md` ("Chunking configuration") for the concrete token-target/overlap rules. Store enough metadata on `DocumentChunk` to make citations possible (section/heading, pageNumber where available).

Ingestion must be idempotent and keyed by `paperNumber` — required both to avoid duplicate documents on repeat runs and to make a future source swap (see `decisions.md`, "Source selection") a normal re-ingestion run rather than a migration.
