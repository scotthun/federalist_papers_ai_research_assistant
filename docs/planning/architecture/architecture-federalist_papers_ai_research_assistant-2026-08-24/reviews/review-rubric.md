# Review: ARCHITECTURE-SPINE.md vs. good-spine checklist

**Target:** `docs/planning/architecture/architecture-federalist_papers_ai_research_assistant-2026-08-24/ARCHITECTURE-SPINE.md`
**Reviewed against:** SPEC.md, decisions.md, data-model.md, stack.md, ui-design.md, testing-approach.md, architecture-diagrams.md, and the two `bmad-deep-recon` research reports it draws on, plus the architecture's own `.memlog.md`.

## Verdict

Mostly sound — the leaf-lib/orchestration boundary rules (AD-6/7/8) and the ingestion-transaction rule (AD-10) are clean and enforceable — but the deployment pivot to serverless (AD-1) introduces two ripple effects the spine doesn't fully chase down (rate-limiting storage, deployment topology), one AD (AD-7) silently contradicts a source document's documented interface, and one capability (CAP-6) collides with an explicit SPEC constraint that no AD resolves.

## Findings

### 1. AD-7 contradicts `architecture-diagrams.md`'s documented retrieval interface — unflagged

`architecture-diagrams.md` (line 28-31, a SPEC companion and architecture source) specifies the retrieval function signature as:

```
retrieveRelevantChunks(query, options)
```
> `options` includes: `topK`, `paperNumber`, `author`, `confidentThreshold`, `clarifyThreshold` (... "replaces a single `similarityThreshold`")

That is, the source document has confidence thresholds passed **into** retrieval as parameters. But AD-7 in the spine states the opposite as a hard rule: *"`retrieval` depends on `database` ... and `ai` ... and returns chunks + scores only. **It has no concept of a confidence threshold** or a citation."*

This is a real, substantive reversal (arguably the correct one, given AD-8's clean orchestrator-owns-thresholds design) — but the spine never flags it as overriding a source document, the way AD-11 explicitly self-flags as `[ASSUMPTION]`. A builder who consults `architecture-diagrams.md` for the exact function signature (it reads as authoritative — it's still listed live in `SPEC.md`'s companions) would reasonably implement a threshold-aware `retrieveRelevantChunks`, directly violating AD-7's "domain-naive retrieval" boundary. This is exactly the kind of two-builder incompatible-divergence the checklist asks to catch, and it's not hypothetical — the conflicting instruction is sitting in a live, still-referenced document.

**Fix:** Either update `architecture-diagrams.md`'s signature to drop the threshold params (making retrieval genuinely naive), or have AD-7 explicitly call out that it supersedes that documented signature.

### 2. AD-2 fixes the daily cap's serverless problem but leaves the per-IP throttle exposed to the same problem

AD-2's own stated rationale is "prevents the counter silently resetting on every serverless cold start" — and it fixes this for the **daily AI-request cap** by moving it to a Postgres row.

But `decisions.md` ("Rate limiting / cost exposure") describes the **MVP per-IP throttle** as using `@nestjs/throttler`'s **in-memory storage**, justified there as fine "because a single process doesn't need a shared external store." That justification is a traditional-single-process assumption, and it is exactly what AD-1 (Vercel serverless) invalidates — the same failure mode AD-2 exists to prevent. AD-2's `Binds:` line scopes it explicitly to "the daily AI-request cap," so it does not cover the per-IP throttle. The result: the spine fixes one instance of a problem it introduced (via AD-1) and leaves a structurally identical instance (the per-IP throttle) unaddressed, with `decisions.md`'s now-stale "in-memory is sufficient" reasoning still standing unchallenged.

Related, narrower gap in the same area: `decisions.md` scopes the entire rate-limiting rationale to "the ask endpoint," but CAP-2's semantic search mode also calls the AI provider (`generateEmbedding`) and carries the identical paid/metered-cost exposure the rate limiter exists to bound. Nothing in the spine states whether the per-IP throttle (or the deferred daily cap) applies to `/search` in its semantic mode. Two builders could reasonably diverge — one gates only `/ask`, another gates every AI-calling endpoint.

**Fix:** Either extend AD-2's rule (or add a sibling AD) to state explicitly what storage backs the per-IP throttle under serverless, and state which endpoints the rate-limiting rules apply to (any endpoint that calls the AI provider, not just `/ask` by name).

### 3. Broken citation trail on the Vercel/Neon "verified" claims in the Stack table

The Stack table states:
> Vercel (hosting) | Native NestJS support confirmed 2026-07-06 (**see `decisions.md`**)

`decisions.md` (the actual companion file under `specs/spec-federalist-research/`) contains **zero mentions of Vercel, Neon, or serverless anywhere** — confirmed by full read and by grep. The only place this verification narrative actually lives is the architecture's own internal `.memlog.md` scratch notes ("Verified 2026-08: Vercel officially supports NestJS as a zero-config serverless deployment target..."), which is not a citable companion and doesn't even carry the specific day-level date (`2026-07-06`) the spine asserts.

I independently web-verified the underlying facts and they check out as of this review: Vercel's own NestJS docs page was indeed last updated 2026-07-06 (explaining where that date actually came from — it's the doc's last-updated date, not a fabricated one), and Neon's free tier is confirmed permanent with pgvector available on all plans. So the *facts* are fine — but the *citation* in the shipped spine document points a future reader to the wrong source (`decisions.md`) for verification, which breaks the traceability the checklist asks for. Someone auditing this claim later, following the spine's own pointer, will find nothing and reasonably conclude it's unverified.

**Fix:** Point the citation at the actual evidence (the memlog entry, or better, a proper verification note added to `decisions.md` or the Stack table itself), not at a document that never discusses it.

### 4. AD-1 leaves the Vercel deployment topology underspecified

AD-1's rule says `apps/web` and `apps/api` "deploy to Vercel (api via Vercel's native NestJS serverless support)" but doesn't pin down:
- **One Vercel project or two** — are `web` and `api` deployed as a single project (same-origin, e.g. via rewrites) or as two separate projects/domains?
- **Cross-origin handling** — if two projects/domains, CORS configuration between them is a real structural decision, undecided and unmentioned anywhere in the spine.
- **Adapter/entry-point shape** — Vercel's zero-config NestJS support has specific expectations about how the Nest app is bootstrapped (bundle size limits, the function entry point). AD-1 asserts the target platform as a hard rule but doesn't constrain the NestJS app shape needed to actually satisfy it, so a builder could make an unrelated-seeming choice (e.g., Fastify adapter, non-standard `main.ts` structure) that turns out incompatible with Vercel's serverless path — discovered only at deploy time, which is precisely the divergence AD-1 is supposed to foreclose.

This is the operational/environmental envelope the checklist specifically asks to scrutinize; deployment target is decided, but the topology details needed to make that decision actually enforceable are not.

### 5. CAP-6 (passage-in-context navigation) is not reconciled with the SPEC's own ephemeral-`chunkId` constraint

`SPEC.md` Constraints (and `decisions.md`, "Chunk ID lifetime") state: *"`chunkId` is ephemeral — valid only within its originating request/response cycle, never persisted, bookmarked, or shared as a stable identifier."*

CAP-6 requires: *"Clicking a citation opens the correct paper's reader and surfaces the cited passage without discarding the original question and answer."* The spine's Capability Map assigns CAP-6 to "`apps/web` reader view ← `apps/api`," governed only by `ui-design.md` — no AD. `ui-design.md` only discusses visual placement/highlighting, not the mechanism for getting from "citation click" to "passage shown," and that mechanism is genuinely constrained: a naive implementation (e.g., a `?chunkId=` route/query param, or a fresh GET keyed on `chunkId`) would violate the "never shareable/bookmarkable" rule the SPEC itself sets, since a URL is exactly a shareable identifier, and a page reload would need to re-resolve a `chunkId` that isn't guaranteed to still exist server-side. Client-side app state, or passing the citation's `quotedPassage` text along for a content-match highlight, would comply — but nothing says which. This is a real, spec-grounded divergence point with no AD resolving it.

### 6. Two minor internal-consistency loose ends

- **Eval script has no home in the Nx graph.** `testing-approach.md` requires a "simple evaluation script" for retrieval quality, and the architecture's own `.memlog.md` (line 18) explicitly uses "the eval script needs raw retrieval only" as a load-bearing argument for AD-8 (why orchestration isn't promoted to a shared lib). Despite being invoked as justification, the Structural Seed and Capability Map never say where this script lives (`apps/eval`? a script under `tools/`? a test inside `libs/retrieval`?) — each choice has different Nx dependency-constraint implications.
- **Dependency diagram vs. Capability Map mismatch.** The mermaid graph shows `api -->|"ingestion orchestration"| database` — labeled specifically for ingestion — but the Capability Map states CAP-1 Browse's paper-list endpoint also reads `libs/database` directly (not through `retrieval`). The diagram never shows a general/unlabeled `api → database` read edge, which is a minor but real slip between the two documents describing the same dependency graph.

## Checked and clean

- **Deferred section** — all five deferred items (threshold values, `libs/rag` promotion, PK type, reranker, exact library versions) are genuinely safe to leave open: each is either single-decision-point, reversible, or has no second consumer yet to diverge against.
- **CAP coverage** — all 7 capabilities (CAP-1 through CAP-7) have an explicit row in the Capability → Architecture Map; none of the SPEC's capabilities are silently unaddressed.
- **Leaf-lib / orchestration boundary rules (AD-6, AD-8, AD-9, AD-10)** — each has a clear, mechanically enforceable rule that plausibly prevents its stated divergence, and AD-10/AD-11 correctly generalize the ingestion write path from the same reasoning already applied to the read path.
- **Framework/library version table** — appropriately marked `unverified` rather than stating fake precision; correctly deferred to a reviewer web-verification pass (this review partially discharges that for Vercel/Neon; Next.js/NestJS/TypeORM/PostgreSQL/pgvector/LangChain.js/Zod versions remain genuinely unverified and should be checked before implementation starts).
