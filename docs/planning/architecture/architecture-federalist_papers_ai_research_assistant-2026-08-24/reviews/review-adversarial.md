---
name: 'Adversarial Review — Federalist Research Architecture Spine'
type: architecture-review
reviews: ../ARCHITECTURE-SPINE.md
created: '2026-08-24'
---

# Adversarial Review — ARCHITECTURE-SPINE.md

Method: for each AD (and each Deferred item), construct two concrete builders — two future engineers, or the same engineer months apart, building against a different but equally literal reading of the same text — who each comply with the Rule as written, yet ship incompatible systems. Findings below are ranked most concrete/damaging first.

---

## 1. AD-2 directly contradicts its own companion doc on the same exact decision

**AD-2's Rule:** "the daily counter is a row in Postgres, mutated via an atomic `UPDATE`/`UPSERT`. No in-memory counter, no Redis."

**`decisions.md`, "Rate limiting / cost exposure" (canonical companion per SPEC.md frontmatter — not a draft):**
> "Global daily cap ... **No Redis needed**: a single process doesn't need a shared external store; **an in-memory counter with a daily reset** ... is sufficient. Redis would only earn its place if this app ran as multiple server processes sharing one counter, which is out of scope."

These are the same concern — the global daily AI-request cap — with opposite storage mechanisms, and both documents are part of "the complete, preservation-validated contract" (SPEC.md's own words). Neither document cross-references or supersedes the other.

**Concrete incompatible pair:** Engineer A opens `ARCHITECTURE-SPINE.md`, reads AD-2, and implements the daily cap as a `rate_limit_counter` Postgres row with an atomic `UPDATE ... SET count = count + 1 WHERE day = $1 RETURNING count`. Engineer B (six months later, or a second contributor who never opens the spine and works straight from `decisions.md`, which is *also* canonical) implements the exact same feature as `@nestjs/throttler` pointed at a fixed key with an in-memory store, per `decisions.md`'s explicit instruction. Both are textually compliant with a canonical document. Engineer B's version is also the one that's actually broken: AD-1 already locked Vercel serverless deployment for `apps/api`, where "a single process" is false by construction — each cold invocation can be a fresh execution context, so the in-memory counter silently resets far more often than "daily," undercounting requests exactly the way AD-2's own "Prevents" clause describes. `decisions.md`'s rationale ("a single process doesn't need a shared external store") was written against a premise (single long-lived process) that AD-1 had already foreclosed — but nothing marks that rationale stale.

**Why this survives "just read both docs":** a reader who opens only one of the two canonical files (entirely plausible — they're in different folders, `specs/` vs `architecture/`) gets a complete, self-consistent, wrong-or-right answer with no signal that the other file disagrees.

**Fix direction:** `decisions.md`'s rate-limiting section needs an explicit strikethrough/update noting AD-2 supersedes the in-memory recommendation for the daily cap now that serverless (AD-1) is locked, or the spine needs a line explaining why it overrides the companion.

---

## 2. AD-8's "second real consumer" trigger already has a live counterexample it had to explain away in prose, not in the Rule

**AD-8's Rule:** "Promote it to `libs/rag` only when a second real consumer appears (a CLI, a worker, another app)."

**The wrinkle, from `.memlog.md` line 18:** the "Rule of Three" justification for *not* promoting already had to address this: "apps/web only calls api over HTTP; **the eval script needs raw retrieval only**." The retrieval evaluation script (`testing-approach.md`) is a real, already-existing script that consumes the pipeline outside `apps/api` — and it is literally "a CLI," the first example AD-8's own Rule text gives for what would trigger promotion. The spine's authors had to argue, outside the Rule itself, that it doesn't count because it only touches `libs/retrieval`, not the full orchestration.

**Concrete incompatible pair:** Six months from now, an engineer builds a second CLI — say, a batch regression tool that re-asks the retrieval evaluation dataset's questions through the *full* pipeline (confidence tiering + citation verification, not just retrieval) to catch answer-quality regressions after a provider swap. Engineer A treats this as clearly "a second real consumer" per AD-8's own parenthetical example and promotes the orchestrator to `libs/rag`, updating `apps/api` to depend on it. Engineer B — maybe the same engineer, on a different day, reasoning from the precedent already set for the eval script — argues this new CLI *also* doesn't count as "real" because it's a test/regression tool rather than a production consumer, and leaves the orchestrator in `apps/api`, having the CLI shell out to the HTTP API instead. AD-8's Rule text gives no mechanical way to settle this: "real" is never defined, and the one precedent on record (the eval script) was resolved by an argument about *what the consumer needs* (raw retrieval vs. full orchestration) that the Rule text doesn't encode at all.

**Why this matters:** this isn't a hypothetical vagueness — the spine's own decision log shows the ambiguity already had to be argued around once. It will recur.

---

## 3. CAP-2's "Governed by: AD-7" is wrong for half the capability, and the WHERE-before-LIMIT constraint has no assigned owner

**Capability map:** "CAP-2 Search | `apps/api` search endpoint → `libs/retrieval` (semantic) + `libs/database` (keyword/full-text) | AD-7"

AD-7 binds `libs/retrieval` only ("Binds: `libs/retrieval`"). The keyword/full-text half of CAP-2 runs through `libs/database` directly, per the map's own middle column — bypassing `libs/retrieval` entirely. No AD binds `libs/database`'s keyword/full-text search behavior. The "Governed by" column is misleading: it names a Rule that only covers one of the two code paths the row itself describes.

This gap is not cosmetic — it collides with a real SPEC constraint: *"Retrieval filters (`paperNumber`/`author`) must apply in the SQL `WHERE` clause before the top-K `LIMIT`, never applied post-hoc on an already-limited result set."*

**Concrete incompatible pair:** Engineer A, implementing filtered semantic search ("find passages about factions, but only in papers by Madison"), extends `libs/retrieval`'s query function to accept `filters: { paperNumber?, authorIds? }` and pushes them into the pgvector query's `WHERE` clause before `LIMIT` — satisfying the SPEC constraint, but requiring `libs/retrieval` to know about `Author`/`FederalistPaper` filter parameters, which arguably breaks AD-7's "domain-naive... chunks in, chunks out" framing (retrieval now has to accept domain-shaped filter args, not just an embedding and a K). Engineer B, reading AD-7 more literally ("no concept of a confidence threshold or a citation" — filters aren't mentioned either way, so keep retrieval to `search(embedding, topK)` only), implements the same feature entirely in the `apps/api` orchestrator: call `libs/retrieval` for topK unfiltered chunks, then filter the returned array in JS by `paperNumber`/`author` before using them. Engineer B's version is a textbook violation of the SPEC's explicit "never applied post-hoc on an already-limited result set" constraint, produced by a completely reasonable reading of AD-7 combined with AD-8's own orchestration pattern ("orchestrator gets chunks from retrieval, then applies business logic to them") — the exact shape AD-8 prescribes structurally invites the anti-pattern SPEC.md separately forbids, and nothing in the spine tells either engineer which layer the filter belongs in.

---

## 4. No AD owns the ingestion-path "chunk" DTO shape — AD-9 has a write-side gap

AD-9 pins the `Answer`/`Citation` read-path contract to `libs/shared` specifically because letting `apps/api` and `apps/web` redeclare it independently causes drift. AD-11 explicitly draws the write-path/read-path parallel ("mirrors answer orchestration") for *orchestration boundaries* — but not for *data shape*. Nothing plays AD-9's role for the object that crosses `libs/documents` → orchestrator → `libs/ai` → orchestrator → `libs/database` during ingestion.

`libs/documents` (AD-6) "performs no I/O" and returns parsed/chunked output; `libs/database` (AD-6) owns the `DocumentChunk` entity shape (`content`, `chunkIndex`, `section`, `pageNumber`, `metadata`, `embedding`). Both ends are owned. The shape in between — what `documents` actually hands the orchestrator, and what the orchestrator must build before calling `database`'s insert — is owned by neither, and no AD says it has to be identical to the `DocumentChunk` entity fields.

**Concrete incompatible pair:** Engineer A's original ingestion command has `libs/documents` return `ParsedChunk { text, index, heading?, page? }`, and writes an inline mapping in the `apps/api` orchestrator (`content: text, chunkIndex: index, section: heading, pageNumber: page`) before calling `database.insertChunks()`, which expects `DocumentChunk`-entity-shaped rows. This mapping shim exists only in that one command's source file — nothing documents that it's required. Engineer B, months later, builds a second, narrower ingestion entry point (e.g., a "re-embed all chunks with a new model, don't re-parse" maintenance script that still needs to go through `documents` → `ai` → `database` per AD-11) and imports `ParsedChunk` directly, assuming — reasonably, since nothing says otherwise — that its field names already line up with what `database` expects, because AD-9 already established the precedent that shared cross-boundary shapes get a single canonical definition. They don't in this case; the mapping shim is uncodified tribal knowledge in the first command. Engineer B's script inserts chunks with missing/undefined `content`/`chunkIndex`/`section`/`pageNumber`, silently, since TypeScript's structural typing (or a stray `as any`) papers over the mismatch at the call site.

---

## 5. Deferred PK-type choice is a correctness gap disguised as a style choice, and the Consistency Conventions table promises coverage it doesn't deliver

**Deferred list:** "Primary-key type for entities (UUID vs. serial) — low-stakes, single-schema decision; left to the migration author, not fixed here."

This framing treats PK type as independently decidable per-entity or per-migration. It isn't: `DocumentChunk.paperId` is a foreign key into `FederalistPaper.id`, and the join table for the `Author` ↔ `FederalistPaper` many-to-many (AD per `data-model.md`) references both. FK column types must match their referenced PK's type. "Left to the migration author" only works safely if there is exactly one migration author who never forgets their own earlier choice — which is precisely the "same engineer six months apart" adversarial case this task asks for.

**Concrete incompatible pair:** Engineer A's first migration defines `FederalistPaper.id` and `Author.id` as `uuid` (`@PrimaryGeneratedColumn('uuid')`), matching a common TypeORM convention. Six months later, the same engineer — or a second contributor — adds a migration for a new entity, or an ALTER touching `DocumentChunk`, and uses TypeORM's bare `@PrimaryGeneratedColumn()` default (auto-increment integer), because nothing in the spine, `data-model.md`, or the Consistency Conventions table says otherwise, and that's TypeORM's own unqualified default. Any FK column typed against the mismatched entity now fails at migration time (or worse, is silently coerced/cast in a way that breaks referential integrity), not because of a subjective style disagreement but because the two ID types are not interchangeable in a foreign key constraint.

**Compounding documentation defect:** the Consistency Conventions table's row is literally labeled *"Data & formats (**ids**, dates, error shapes, envelopes)"* — but the cell text only addresses dates and error shapes ("Dates ISO 8601; API errors use NestJS's default `HttpException` shape..."). The row's own header promises an ID convention that the cell never states. This is a real gap in the document itself, not just an inherently hard problem being deferred: a UUID-vs-serial call is cheap to pin — cheaper than PK type ever becomes once a second migration exists — and the table's own structure shows the spine's author intended to pin it and then didn't.

---

## 6. AD-10/AD-11/AD-6 don't say who opens the ingestion transaction — two incompatible repository-API shapes both comply

AD-10: "all three steps for a single paper run inside one database transaction." AD-11: the orchestrator (in `apps/api`) "compos[es] `documents` + `ai` + `database`... applying AD-10's transaction rule." AD-6: `database` "owns Postgres/pgvector schema + repositories." None of the three says *where the transaction boundary is opened* or what that requires of `libs/database`'s public API.

**Concrete incompatible pair:** Engineer A opens a `DataSource.transaction()` in the `apps/api` orchestrator and threads the transactional `EntityManager`/query-runner into three separate repository calls (`paperRepo.upsert(paper, manager)`, `chunkRepo.deleteByPaperId(id, manager)`, `chunkRepo.insertMany(chunks, manager)`) — which requires every `libs/database` repository method that might participate in a multi-step transaction to accept an optional manager/transaction parameter, an API-wide convention nothing in the spine specifies. Engineer B instead keeps `apps/api`'s orchestrator ignorant of transactions entirely and pushes the whole thing into `libs/database` as one composite method, `paperRepository.replacePaperAndChunks(paper, chunks)`, which opens its own internal transaction and does all three steps as a black box.

Both comply with AD-10's literal text. They are not compatible: Engineer A's regime requires every repository method that ever needs to participate in a larger transaction to support manager-threading (a pattern that has to be applied consistently or it silently stops being atomic wherever it's missing); Engineer B's regime requires `libs/database` to expose paper+chunk composite methods that blend two entities' concerns into one repository call, and provides no primitive for a future single-entity transactional write (e.g., a later admin "edit paper metadata only" endpoint) without either reusing the composite method wrongly or inventing a second, inconsistent transaction pattern next to it.

---

## 7. (Secondary) AD-3 + AD-4 + AD-5 leave the PgBouncer/prepared-statement seam completely undefined

AD-3 mandates Neon's *pooled* connection endpoint in production; AD-4 gives local dev a bare, unpooled `pgvector/pgvector` container; AD-5 forbids any environment-conditional code branch, requiring all differences to be env-var-encoded. Neon's pooled endpoint runs through PgBouncer in transaction-pooling mode, which is well known (and already partially acknowledged in `.memlog.md`'s "documented gotcha" note about connection counts) to break session-scoped Postgres features — prepared statements chief among them, which TypeORM's `pg` driver may issue by default for parameterized queries. Local dev, hitting Postgres directly with no pooler, will never surface this; it is a production-only failure mode.

AD-5's letter doesn't forbid fixing this correctly (the fix — e.g., disabling prepared-statement caching, or making it env-var-driven — is itself just another env var, so it's compliant), but the spine gives zero indication this consideration exists. One engineer ships a `DataSource` config that happens to disable statement caching unconditionally (safe in both environments, arrived at by caution or luck); another ships TypeORM defaults, tests exhaustively against local Docker Postgres per AD-4, and only discovers the incompatibility against Neon's pooled endpoint after a production deploy — a gap between AD-3 and AD-4 that AD-5 doesn't help close because it only legislates *how* to express a difference, not *that one exists here*.

---

## 8. (Secondary) AD-9's Rule is scoped to "Answer/Citation" by name, not to "any web/api shared contract" by spirit

`decisions.md`'s "Librarian, not editor" section describes a future structured "AI-assisted navigation" intent object ("open paper 51 at chunk 12... side by side") explicitly as "a small, deterministic extension of the existing citation schema." AD-9's actual Rule text names only "the `Answer`/`Citation` API contract." A future implementer of that navigation feature can comply with AD-9 to the letter while defining the navigation-intent schema as a one-off type local to `apps/api` (for `generateStructuredOutput` validation) and a hand-maintained matching TypeScript interface in `apps/web` — reproducing, for this one field, exactly the drift AD-9 exists to prevent, because the Rule's text is narrower than its own rationale.

---

## Verdict

The spine is internally coherent on the boundaries it explicitly drew (leaf-lib isolation, retrieval/orchestration split, deployment envelope) but has one outright contradiction with a co-canonical companion document (finding 1), one Rule whose own decision log already shows it can't be applied mechanically (finding 2), and several real seams — the search-filter WHERE-clause owner, the ingestion chunk DTO shape, the transaction-boundary owner, and the PK type — that are silently left to whichever engineer happens to write the first line of code, with no mechanism to keep a second engineer's equally-compliant choice compatible with the first.
