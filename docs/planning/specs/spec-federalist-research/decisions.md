# Locked Decisions

Each decision below was validated through elicitation (multi-perspective critique) and/or research (`bmad-deep-recon`), not assumed. Full research trails are in the adopted companions listed in `SPEC.md` frontmatter.

## Source selection: the Avalon Project

**Ingestion source: the Avalon Project** (Yale Law School, Lillian Goldman Law Library) — `avalon.law.yale.edu/18th_century/fed{NN}.asp`, zero-padded 01–85. This URL doubles as the `sourceUrl` shown to end users for independent verification (CAP-7).

Chosen over Library of Congress, National Archives/Founders Online, and Congress.gov/GovInfo.gov after a `bmad-deep-recon` comparison (full report: `../research/technical-federalist-papers-ingestion-source-2026-08-24/research.md`):
- Congress.gov/GovInfo.gov were eliminated outright — neither hosts the 85 papers as a standalone corpus, only citations to them inside an unrelated document.
- Avalon is the only candidate with all 85 papers on plain, uniform HTML, no auth wall, and a URL scheme independently verified (two separate research passes) stable since 2008 — the strongest longevity evidence found.
- Founders Online has stronger academic pedigree (peer-reviewed critical editions) but failed direct automated fetching on every attempt tested — a real ingestion and live-link reliability risk.
- Known gap: Avalon publishes no provenance statement of its own. Mitigated by an empirical fidelity check — 3 papers / 8 passages spot-checked word-for-word against Library of Congress's documented text came back essentially verbatim (one trivial OCR-level discrepancy). Treated as evidence, not certainty; a larger-sample re-check is cheap if it ever matters more than it does today.

**Pivot strategy** if a better-sourced archive shows up later: a normal re-ingestion run, not a migration, as long as ingestion is idempotent and keyed by `paperNumber` (required — see `data-model.md`): update the `FederalistPaper` row's `fullText`/`sourceUrl`/metadata in place on its existing primary key, delete that paper's `DocumentChunk` rows, re-chunk and re-embed. For 85 papers that's minutes and pocket change in embedding-API cost, no schema change, no vector column/index rebuild. The one genuinely expensive migration is swapping the **embedding model or dimension** — that forces a vector column/index rebuild and is a separate concern from swapping the text source.

## Authorship modeling

See `data-model.md`. Many-to-many `Author` ↔ `FederalistPaper`, chosen over a string column or array column, to represent disputed/joint authorship (Nos. 18–20, 62–63) correctly and to give authorship a proper home if it ever grows attached metadata.

## Librarian, not editor

The system routes users to documents; it never generates, edits, or constructs the reading experience itself. Concretely: "AI-assisted navigation" (e.g. a structured intent like "open paper 51 at chunk 12, open paper 10 at chunk 4, side by side") is in scope as a small, deterministic extension of the existing citation schema — the model returns a structured object, the frontend renders it with a fixed, predefined view type. Actual UI generation by the model (the model deciding layout/rendering) is explicitly out of scope: it would validate arbitrary output instead of a fixed schema, and directly conflicts with the "no general-purpose agent framework" non-goal. This resolves the tension between wanting a fluid, AI-assisted browsing feel and principle 6 (prefer deterministic logic).

## Confidence tiering

Retrieval confidence drives a three-tier response, entirely decided in code — never by asking the LLM to self-report confidence:

- **Score ≥ `confidentThreshold`** — full grounded answer generation. `confidence` derived from where the score falls, never from LLM self-report.
- **`clarifyThreshold` ≤ score < `confidentThreshold`** — no LLM call for generation. A templated, code-generated response naming the best-guess paper (e.g. "I think you might be asking about Federalist No. 51, but I'm not confident enough to answer directly — can you add more detail?"), `insufficientEvidence: true`, `confidence: "low"`, one best-guess citation (not a proven source).
- **Score < `clarifyThreshold`** — blanket "I couldn't find sufficient evidence..." response, `insufficientEvidence: true`, empty citations.

Validated via `bmad-deep-recon` (full report: `../research/technical-rag-confidence-tiering-2026-08-24/research.md`). No production RAG system was found using this exact three-way similarity gate — most use a single binary cutoff — but the pattern is well-established in adjacent conversational-AI systems (Rasa, Amazon Lex use identical high/medium/low confidence banding for intent recognition, not RAG). Research surfaced a real caveat: a high similarity score does not guarantee a correct or complete answer — retrieved-but-marginal context can increase hallucination risk rather than trigger correct refusal. This is exactly why citation-ID server-side verification stays mandatory in *every* tier, including "confident" — it's the actual safety net, not the threshold.

Threshold values are deliberately unresolved here — no universal cosine-similarity cutoff exists across embedding models/datasets. Calibrate empirically using the retrieval evaluation dataset (see `testing-approach.md`): sweep candidate values and pick what actually separates "expected paper retrieved" from "not retrieved" for the chosen embedding model.

Explicitly out of scope (disproportionate engineering effort for this project): a trained relevance classifier (CRAG-style) or a full groundedness-scoring pipeline (RAGAS-style) as the confidence signal.

## Citation verification

Verification is a deterministic set-membership check, not an AI judgment call: the backend already knows the exact set of chunk IDs sent to the LLM as context, so checking a returned `chunkId` is a plain lookup — no model call needed for the check itself.

When a returned citation's `chunkId` is not in that set (a documented LLM failure mode — the same category of error as lawyers submitting fabricated case citations from ChatGPT):
1. **Retry once** — re-send the question and context with an explicit correction naming the invalid ID(s) and the full list of valid IDs.
2. **If the retry still fails, fail safe** — return the same "insufficient evidence" fallback used elsewhere, rather than silently stripping the bad citation and serving the rest of the answer. Stripping is explicitly rejected: the answer's prose may still be making the claim that citation was backing, so removing only the citation produces an answer that *looks* fully verified but isn't — a worse trust violation than an honest fallback.

## Chunk ID lifetime

A `chunkId` is valid only within the request/response cycle that produced it — never a stable, bookmarkable, or shareable identifier. Re-ingestion deletes and recreates `DocumentChunk` rows (see "Source selection" pivot strategy above), so a `chunkId` seen today is not guaranteed to resolve after a future re-ingestion. Do not build any feature (e.g. a "shareable citation link") that persists or shares a raw `chunkId` outside its originating response.

## Verification link placement

The `sourceUrl` link lives as a **quiet tag near the paper title** on the Paper Reader page (e.g. "Source: Avalon Project ↗"), not inline at every cited passage and not in a separate drawer.

Why: Avalon's pages have no internal anchors (confirmed by inspecting the raw HTML of a live page), so the link can only ever land a reader at the top of the whole paper, never at the specific cited sentence. Since the link can't prove passage-level accuracy no matter where it's placed, putting it prominently next to a specific citation would misrepresent what it actually does — its real job is institutional legitimacy ("this whole document is real and here's where it came from"), not sentence-level proof. Sentence-level trust (does *this* citation actually say what the answer claims) is carried entirely by the app's own citation display, not the external link.

## Deployment target

**Vercel** (both `apps/web` and `apps/api`, the API via Vercel's native NestJS serverless support) + **Neon** (Postgres+pgvector). Chosen for genuinely free, no-card-on-file hosting (see architecture spine `AD-1`, `docs/planning/architecture/architecture-federalist_papers_ai_research_assistant-2026-08-24/ARCHITECTURE-SPINE.md`) — full evaluation of hosting options happened during architecture coaching, not spec-time, which is why it's cross-referenced here rather than re-derived. This decision *amends* the rate-limiting decision below: it was written assuming a single always-on process, which serverless does not provide.

## Quill chat widget: streaming, statelessness, persistence

Surfaced by the finalized `bmad-ux` run (`../ux-designs/ux-federalist_papers_ai_research_assistant-2026-08-29/`) that redesigns the ask flow as a floating quill-icon chat widget (CAP-8, CAP-9).

**Stateless per message.** Each chat message is sent to the existing ask endpoint independently, exactly like today's single-shot Ask the Archive request — no server-side conversational memory, no follow-up-question resolution ("what about him?" won't resolve against a prior turn). Chosen over true conversational RAG specifically because there's no auth/user accounts (NFR1) to hang a persisted server-side session on, and the project's own scope-discipline principle (see `SPEC.md`, "Why") argues against the added complexity — a new companion for history truncation/summarization, and per-turn interaction with confidence tiering and citation verification — for a portfolio-scale project.

**Client-side history only.** Chat history lives in the browser's `sessionStorage`, not `localStorage` and not a cookie: it needs to persist across page navigation within a tab (matches the UX decision that history survives navigating Browse Papers ↔ Paper Reader) but should clear on tab close rather than linger indefinitely with no server-side way to ever clean it up. A cookie was rejected outright — it would round-trip on every request for something that's purely client-display, and cookie size limits would be hit by a growing transcript.

**Streaming stops at the citation boundary.** The confident tier's answer prose streams token-by-token, but citations attach only once the full response completes and passes the existing server-side citation-verification check (CAP-5) — streaming cannot be allowed to leak an unverified citation mid-response, since verification is the actual safety net (see "Citation verification" above). Clarify/refuse tiers stay instant since they're already template-generated with no LLM call — nothing to stream.

**Page-context filter reuses CAP-2's mechanism.** When the chat's removable "📄 Federalist No. N" context chip is present, the ask endpoint receives the same `paperNumber` filter search already applies (NFR6: filter-before-limit) — not a new filtering mechanism. Removing the chip clears the filter and the question searches the whole archive again.

**Rate limiting is unchanged per message.** Every chat message still counts as one request against the existing per-IP/global-daily Postgres-backed counters (NFR5) — no special-casing for "it's part of a conversation." The limit exists to bound cost exposure per AI-backed call, and a multi-turn conversation is still N individual AI-backed calls.

## Rate limiting / cost exposure

Principle 8 rules out authentication, but the ask endpoint calls a paid or free-tier-metered AI provider (OpenRouter or a free Google Gemini key — provider undecided, doesn't change this design) with no per-user identity to gate on. Two limits, defending against different things:

1. **Per-IP throttle (MVP, required)** — a light request-per-minute cap. **Amended 2026-08-24:** originally specified as in-memory (`@nestjs/throttler` default storage) on the assumption of a single always-on process. Once the deployment target was fixed to Vercel serverless (see "Deployment target" above), that assumption no longer holds — an in-memory counter resets on every cold start and silently stops limiting anything. Now specified as a **Postgres-row-backed counter**, same mechanism as the daily cap below, keyed by `(ip, minute-bucket)` instead of a single global key. A per-*second* cap alone was still rejected for the reason originally given: it stops a burst but not a slow, sustained drain.
2. **Superseded 2026-09-14 (see below):** **Global daily cap (deferred past MVP, design fixed now so it isn't lost)** — a hard ceiling on total AI-backed requests per day across all callers, bounding worst-case cost/quota exposure. A row in Postgres, atomic `UPDATE`/`UPSERT`, keyed by date. **No Redis needed** even under serverless: Postgres is already a hard dependency for everything else in this app, so a counter table isn't new infrastructure — it's reusing what's already there. Both counters (per-IP and daily) use the same mechanism for consistency; see architecture spine `AD-2`.

**Amended 2026-09-14 (Story 4.2): Upstash Redis, not Postgres.** Supersedes the 2026-08-24 amendment's "no Redis needed" conclusion above — a deliberate, human-directed change this session, not a new inference. Both counters (per-IP-per-minute, global-daily) are now implemented as sliding-window `Ratelimit` instances (`@upstash/ratelimit` + `@upstash/redis`) against Upstash's free-tier REST Redis, not Postgres rows. No new Postgres migration/table was added or is planned for this. Both limits stay env-var-configurable (`ASK_RATE_LIMIT_PER_MINUTE` default 10, `ASK_DAILY_LIMIT` default 250) and the guard (`RateLimitGuard`, `apps/api/src/app/rate-limit/`) is fully inert — no Redis call at all — whenever `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are unset, preserving zero-setup local dev. See `docs/implementation/spec-4-2-rate-limiting-upstash.md` for the full rationale and I/O matrix.
