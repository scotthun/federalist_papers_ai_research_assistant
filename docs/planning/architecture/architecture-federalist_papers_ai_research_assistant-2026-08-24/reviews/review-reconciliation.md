---
type: review
review-of: ../ARCHITECTURE-SPINE.md
against:
  - ../../../specs/spec-federalist-research/SPEC.md
  - ../../../specs/spec-federalist-research/decisions.md
  - ../../../specs/spec-federalist-research/data-model.md
  - ../../../specs/spec-federalist-research/stack.md
  - ../../../specs/spec-federalist-research/architecture-diagrams.md
  - ../../../specs/spec-federalist-research/ui-design.md
  - ../../../specs/spec-federalist-research/testing-approach.md
created: '2026-08-24'
---

# Reconciliation Review — Architecture Spine vs. SPEC and Companions

Scope: only gaps/contradictions between the spine and its driving inputs are reported. Consistent
decisions are not relitigated.

## Findings, most severe first

### 1. [CONTRADICTION] MVP-required per-IP throttle is left on an implementation decisions.md locked, but the spine's own serverless assumption breaks it

- **decisions.md** ("Rate limiting / cost exposure") locks the **per-IP throttle as MVP-required**,
  implemented via `@nestjs/throttler` with **in-memory storage**, explicitly reasoned as fine
  because "a single process doesn't need a shared external store."
- The spine's **AD-1** introduces a Vercel serverless deployment for `apps/api` — a decision not
  present anywhere in SPEC.md or any companion (confirmed by grep: zero hits for
  "Vercel"/"Neon"/"serverless" outside the spine and its memlog).
- The spine's own **AD-2** acknowledges this breaks in-memory state ("Prevents: the counter
  silently resetting on every serverless cold start") — but AD-2's rule is scoped only to **the
  daily cap counter**. It says nothing about the per-IP throttle, which decisions.md still
  specifies as in-memory.
- Net effect: under the spine's stated deployment model, the per-IP throttle — the one rate limit
  decisions.md calls MVP-required — would not reliably throttle anything (concurrent/cold-started
  serverless invocations don't share in-memory counters), and the spine never revisits or flags
  this. Either AD-2's DB-backed rule needs to extend to the per-IP throttle too, or the spine needs
  to explain why in-memory is still safe for it under Vercel.

### 2. [CONTRADICTION] AD-7 ("retrieval has no concept of confidence threshold") conflicts with architecture-diagrams.md's retrieval function signature

- **architecture-diagrams.md** specifies the retrieval interface explicitly:
  `retrieveRelevantChunks(query, options)` where `options` includes `topK`, `paperNumber`,
  `author`, **`confidentThreshold`, `clarifyThreshold`** ("replaces a single
  `similarityThreshold`").
- The spine's **AD-7** states: "`retrieval` depends on `database` ... and `ai` ... and returns
  chunks + scores only. **It has no concept of a confidence threshold** or a citation."
- These are in direct tension: one source document puts the threshold values inside the retrieval
  call's own parameter list; the spine's rule says retrieval must not know about thresholds at
  all. The spine silently overrides the diagram's signature without noting the conflict or
  explaining whether `options.confidentThreshold`/`clarifyThreshold` still get passed through
  (e.g., for an early-exit optimization) while remaining uninterpreted by `retrieval` itself, or
  whether architecture-diagrams.md's signature is simply superseded. As written, an implementer
  following architecture-diagrams.md literally would violate AD-7.

### 3. [UNFLAGGED ASSUMPTION] Deployment target (Vercel + Neon) is the single largest unsourced bet in the spine, and isn't marked as such

- AD-1 through AD-4 (Vercel + Neon hosting, Neon pooled-connection requirement, Docker
  Compose-is-local-only) and the Stack table's Vercel/Neon rows introduce a complete, specific
  hosting and deployment architecture that appears **nowhere** in SPEC.md or its six companions.
- This is not flagged as an assumption anywhere in the spine's prose — contrast with **AD-11**,
  which is explicitly labeled `[ASSUMPTION]` with a "Flag if this doesn't match intent" note for a
  much lower-stakes symmetry argument (write-path mirrors read-path).
- Given this deployment choice is the direct cause of Finding 1 (the rate-limiting contradiction),
  its unflagged status compounds the risk: a reader has no signal that this whole area is a spine-
  time invention rather than a locked decision, and so no prompt to double-check it against
  decisions.md's rate-limiting reasoning.

### 4. [GAP] Source acquisition (fetching Avalon Project pages) has no assigned owner

- **stack.md**'s phase 3 lists ingestion as: "source acquisition (Avalon Project, see
  `decisions.md`), parser, chunker, metadata, embedding generation, database ingestion" — five
  distinct concerns, with source acquisition (an HTTP fetch) named separately from parsing.
- The spine's **AD-6** makes `libs/documents` explicitly I/O-free ("parsing/chunking only — no
  I/O, no embedding calls, no DB calls").
- The spine's **AD-11** describes the ingestion orchestrator as composing "`documents` (parse/
  chunk) + `ai` (embed) + `database` (store)" — three steps, dropping the fetch step entirely from
  the composition list. No lib and no explicit orchestrator responsibility is named for the actual
  network fetch of `avalon.law.yale.edu/18th_century/fed{NN}.asp`. It presumably lands as inline
  logic in the `apps/api` ingestion command by default, but the spine never says so.

### 5. [QUIET REQUIREMENT, WEAKLY CARRIED] `chunkId` ephemerality vs. CAP-6 navigation

- **decisions.md** ("Chunk ID lifetime") is emphatic: a `chunkId` is "valid only within the
  request/response cycle that produced it — never a stable, bookmarkable, or shareable
  identifier," and explicitly warns against building "any feature (e.g. a 'shareable citation
  link') that persists or shares a raw `chunkId` outside its originating response."
- **CAP-6** ("Passage-in-context navigation") requires: "Clicking a citation opens the correct
  paper's reader and surfaces the cited passage **without discarding the original question and
  answer**" — which implies some carry-over of the citation (chunkId and/or quotedPassage) from
  the Ask-the-Archive view to the Paper Reader view.
- The spine's Capability Map cites only `ui-design.md` as CAP-6's governance and adds no rule
  clarifying how this navigation is implemented without treating `chunkId` as a persisted/
  shareable identifier (e.g., same-session client-side state vs. a URL query param, which would
  edge toward "shareable"). Not a contradiction — no AD explicitly permits the violating pattern —
  but the spine drops an opportunity to make this constraint self-enforcing at the one spot in the
  system where it's easiest to accidentally violate.

### 6. [MINOR GAP] Retrieval evaluation script has no home in the Structural Seed

- The spine's own `.memlog.md` justifies **AD-8** (keeping orchestration in `apps/api` rather than
  promoting to `libs/rag`) partly via a Rule-of-Three argument: "apps/web only calls api over HTTP;
  **the eval script needs raw retrieval only**."
- `testing-approach.md` requires building this evaluation script ("Build a simple evaluation
  script that reports whether an expected paper appears in the top-K retrieved chunks").
- Neither the Structural Seed nor the Capability → Architecture Map places this script anywhere in
  the Nx monorepo (no `apps/eval`, no `tools/`, no scripts location named), even though the spine's
  own reasoning treats it as a second real consumer of `libs/retrieval`.

## Areas checked and found consistent (not relitigated)

- All CAP-1 through CAP-7 have a row in the Capability → Architecture Map; CAP-1, CAP-3, CAP-4,
  CAP-5, CAP-7 map cleanly to their governing AD/decision with no contradiction.
- Avalon Project source selection, many-to-many `Author` modeling, "librarian not editor"
  boundary, confidence-tiering three-tier logic, citation retry-then-fail-safe policy, and
  verification-link placement are all referenced accurately and not weakened by any AD.
- AD-6/AD-9/AD-10 and the Structural Seed match `data-model.md`, `stack.md`'s monorepo layout, and
  the AI provider abstraction's three methods exactly.
- The "no auth" constraint, "one lib per concern" constraint, and "deterministic logic preferred
  over LLM judgment" constraint are all explicitly carried into the spine's Consistency
  Conventions / AD-7 / AD-8.

## Not flagged as a gap, but worth a note

- decisions.md's "Librarian, not editor" section describes an illustrative future capability
  ("open paper 51 at chunk 12, open paper 10 at chunk 4, side by side") as in-scope-if-built. This
  isn't one of SPEC.md's numbered capabilities (CAP-1–7) and isn't in the spine's Deferred list
  either. Likely fine to leave out since it's boundary-setting prose rather than a committed
  deliverable, but noting it here in case that reading is wrong.
