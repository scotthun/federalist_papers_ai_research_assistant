---
title: 'Add OpenRouterProvider (Nemotron free-tier) as a second AIProvider'
type: 'feature'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 0
context: []
baseline_revision: '8b45792aa1bfaccdd2dfdca723ad34cef89d1c3e'
followup_review_recommended: false
deferred:
  - summary: >-
      OpenRouter's 429 daily-vs-per-minute rate-limit classification is a string-match heuristic
      never verified against a real OpenRouter error response.
    evidence: |-
      classifyOpenRouterError/isDailyQuotaMessage (libs/ai/src/lib/providers/openrouter.provider.ts)
      classifies a 429 as rate_limited_daily vs rate_limited_short by regex-matching "day"/"daily"
      in the error body's message field. No live OPENROUTER_API_KEY was available in this
      environment to capture a real response, so both the implementation and its tests are built
      from the same 2026-09-05 research/assumption about OpenRouter's wording, not a captured
      sample. If the real wording differs, a genuine daily-cap exhaustion could be told "wait a
      few seconds" instead of "this won't recover until tomorrow" (ask.service.ts's
      messageForFailureKind branches user-facing text on this exact classification).
    location: >-
      libs/ai/src/lib/providers/openrouter.provider.ts:1429-1478
    severity: medium
  - summary: >-
      AI_PROVIDER=gemini (the default) now constructs two independent GeminiProvider instances
      (one via createEmbeddingProvider, one via createGenerationProvider) instead of one shared
      instance.
    evidence: |-
      Splitting EMBEDDING_PROVIDER/GENERATION_PROVIDER into two independently-memoized lazy DI
      providers (apps/api/src/app/ai-provider.provider.ts) means AskModule now builds two separate
      ChatGoogleGenerativeAI/GoogleGenerativeAIEmbeddings client sets when AI_PROVIDER=gemini,
      where the prior single AI_PROVIDER token shared one memoized construction across both
      methods. Functionally harmless (both are stateless SDK client wrappers) but a real resource
      cost change worth a conscious accept/optimize decision later.
    location: >-
      apps/api/src/app/ai-provider.provider.ts
    severity: low
  - summary: >-
      No test exercises AI_PROVIDER=openrouter through AskModule's real DI wiring end-to-end (the
      way ask.http.spec.ts does for the fake/default path).
    evidence: |-
      ai-provider.factory.spec.ts covers createGenerationProvider's openrouter case in isolation;
      ask.http.spec.ts covers AskModule's DI wiring with fake providers. Nothing combines the two
      -- e.g. booting AskModule with AI_PROVIDER=openrouter and a fake OPENROUTER_API_KEY to prove
      the real DI graph resolves to an OpenRouterProvider, not just that the factory function does
      in unit isolation.
    location: >-
      apps/api/src/app/ask/ask.module.ts
    severity: low
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app currently has exactly one `AIProvider` implementation (`GeminiProvider`), and Gemini's free tier has proven unreliable for a live demo (`gemini-3.6-flash` returning 429/503 "high demand"/daily-quota errors repeatedly, per `libs/ai/src/lib/providers/gemini.provider.spec.ts`'s error-classification suite and live testing 2026-09-03). `NFR2` (`docs/planning/epics.md:39`) already requires the AI provider to be swappable via configuration/environment variables alone — this story adds the second concrete provider that NFR2's abstraction was built to support (GH-24 built the seam; this story is the first thing to prove it by plugging something else into it).

**Approach:** Implement `OpenRouterProvider` in `libs/ai/src/lib/providers/openrouter.provider.ts`, implementing the existing `AIProvider` interface unchanged, backed by OpenRouter's OpenAI-compatible chat-completions API via `@langchain/openai`'s `ChatOpenAI` with `configuration.baseURL` overridden to `https://openrouter.ai/api/v1`. Extend `ai-provider.factory.ts`'s `AI_PROVIDER` switch with an `'openrouter'` case reading `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` from env. Default model: `nvidia/nemotron-3-super-120b-a12b:free` (OpenRouter's only free Nemotron model exposing both native `structured_outputs`/`response_format` and `tools`/`tool_choice`, per this story's OpenRouter research, 2026-09-05 — the other free Nemotron variants only expose tool-calling, which LangChain's `.withStructuredOutput()` would still use as a fallback but less reliably than native JSON mode).

Embeddings are explicitly out of scope: `retrieval.ts`'s pgvector column and all stored embeddings are pinned to Gemini's 3072-dimension `gemini-embedding-001` output (see `gemini.provider.ts`'s own comment: "changing it is a deliberate, separately-costed migration"). `OpenRouterProvider.generateEmbedding` is not implemented in this story — see Boundaries.

## Boundaries & Constraints

**Always:**
- `AIProvider`'s two method signatures (`generateEmbedding`, `generateStructuredOutput`) are unchanged — `OpenRouterProvider` implements the same interface as `GeminiProvider`, no interface changes.
- `ai-provider.factory.ts`'s existing `'gemini'` case, its error messages, and `GeminiProvider`'s behavior are unchanged — this is strictly additive.
- New env vars: `OPENROUTER_API_KEY` (required when `AI_PROVIDER=openrouter`), `OPENROUTER_MODEL` (optional, defaults to `nvidia/nemotron-3-super-120b-a12b:free`) — documented in `apps/api/.env.example`, mirroring `GEMINI_GENERATION_MODEL`'s existing override pattern.
- `generateStructuredOutput` re-validates the model's output against the caller's own Zod `schema` (never trusts LangChain's schema hinting alone) and never retries internally — one model call per invocation, matching `GeminiProvider`'s existing contract (`ai-provider.interface.ts`'s doc comments).
- On a failed call, wrap the error in `ProviderUnavailableError` classified into a `ProviderFailureKind`, same as `GeminiProvider`'s `classifyFetchError` — OpenRouter's OpenAI-compatible API returns standard HTTP status codes (429 rate-limited, 5xx server/overload, 4xx client/config) so the classification logic is the same shape, just keyed off `ChatOpenAI`'s/OpenAI-SDK's error shape (`.status`/`.error?.code`) instead of `@google/generative-ai`'s `GoogleGenerativeAIFetchError` shape. A 429 from OpenRouter's free-tier daily cap (50 or 1000 req/day depending on account credit) classifies as `rate_limited_daily`; a 429 from the flat 20-req/min cap classifies as `rate_limited_short`.
- `maxRetries: 0` on the `ChatOpenAI` client, matching `GeminiProvider`'s existing "never retries internally" contract (`@langchain/core`'s `AsyncCaller` otherwise silently retries transient errors up to 6 times).
- Add `@langchain/openai` to `package.json` at a version whose `@langchain/core` peer range accepts this repo's pinned `@langchain/core@1.2.9` (verify during implementation, same as GH-24's spec did for `@langchain/google-genai`).
- Update `ai-provider.factory.spec.ts` with new tests for the `'openrouter'` case (env var pass-through, default model, missing-API-key error) — same coverage shape as its existing `'gemini'` case tests.
- New `openrouter.provider.spec.ts` mirroring `gemini.provider.spec.ts`'s structure: construction, structured-output happy path, schema-validation failure, provider-unavailable wrapping, and the same error-classification matrix (429 daily/short, 5xx, other 4xx).

**Never:**
- Do not implement `generateEmbedding` on `OpenRouterProvider` beyond a clear "not supported" throw — embeddings stay Gemini-only (see Intent). If `AI_PROVIDER=openrouter` is set, retrieval/ingestion embedding calls must still route to Gemini, or the factory must document/enforce that embeddings need a separate, always-Gemini path. **This split needs a decision during implementation** — flag it in the Spec Change Log rather than silently picking one.
- Do not touch `ask.service.ts`, `retrieval.ts`, or any other consumer — same "the seam is the factory + interface, not the call sites" boundary as GH-24.
- Do not hardcode `nvidia/nemotron-3-super-120b-a12b:free` as anything other than a default — it must be overridable via `OPENROUTER_MODEL`, since OpenRouter's free-model catalog and rate-limit tiers can change (this story's own research flagged some previously-known free Nemotron variants, e.g. `nemotron-nano-9b-v2:free`, as no longer listed as of 2026-09).
- Do not assume OpenRouter free-tier rate limits are per-model — they are account-level (20 req/min flat; 50 or 1000 req/day depending on lifetime credit purchase) — the `rate_limited_daily` vs `rate_limited_short` classification must reflect that.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Factory happy path | `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY` set | Returns an `OpenRouterProvider` | N/A |
| Factory missing key | `AI_PROVIDER=openrouter`, no `OPENROUTER_API_KEY` | — | Throws naming the missing env var, same style as the existing Gemini case |
| Model override | `OPENROUTER_MODEL=some/other:free` set | `ChatOpenAI` constructed with that model | N/A |
| Model default | `OPENROUTER_MODEL` unset | `ChatOpenAI` constructed with `nvidia/nemotron-3-super-120b-a12b:free` | N/A |
| Structured output happy path | Chat completion resolves an object matching `schema` | Returns the validated object | N/A |
| Structured output fails Zod schema | Resolves an object that doesn't satisfy `schema` | — | Throws a clear validation error, exactly one call made |
| Call rejects — 429, daily-quota shape | Underlying call rejects with a 429 whose error body indicates the daily/free-tier cap | — | `ProviderUnavailableError` with `kind: 'rate_limited_daily'` |
| Call rejects — 429, no daily-quota indication | Underlying call rejects with a plain 429 (per-minute cap) | — | `ProviderUnavailableError` with `kind: 'rate_limited_short'`, `retryAfterSeconds` if the response provides one |
| Call rejects — 5xx | Underlying call rejects with 503/500 | — | `ProviderUnavailableError` with `kind: 'overloaded'`/`'server_error'` |
| Call rejects — other 4xx | Underlying call rejects with 401/400 | — | `ProviderUnavailableError` with `kind: 'client_error'` |
| Call rejects — no status at all | Plain network error/timeout | — | `ProviderUnavailableError` with `kind: 'unavailable'` |
| `generateEmbedding` called | Any input | — | Throws a clear "not supported by OpenRouterProvider, use Gemini for embeddings" error (pending the embedding-routing decision above) |

</frozen-after-approval>

## Spec Change Log

- **Resolves the Boundaries' "Never" item 1 embedding-routing question, decided 2026-09-05 before implementation started (not left to the implementer to guess):** `AIProvider` splits into two separately-configured seams instead of one interface an `OpenRouterProvider` would only partially implement. Add `createEmbeddingProvider(env)` (always constructs `GeminiProvider` for embeddings, regardless of `AI_PROVIDER`) and `createGenerationProvider(env)` (the existing `AI_PROVIDER`-driven switch, now for generation only). `ai-provider.interface.ts`'s `AIProvider` interface splits into `EmbeddingProvider` (`generateEmbedding`) and `GenerationProvider` (`generateStructuredOutput`); `GeminiProvider` implements both (it still does both jobs for the `'gemini'` case), `OpenRouterProvider` implements only `GenerationProvider` — it is a complete, honest implementation of the interface it actually claims, not a `generateEmbedding` stub that throws. Every consumer (`ask.service.ts`'s generation calls, `retrieval.ts`/ingestion's embedding calls) already calls one specific method today, not a shared `AIProvider` handle — confirm this at implementation time and update each call site's import/type from `AIProvider` to the specific narrower interface it actually uses, and from `createAIProvider()` to whichever of the two new factory functions matches. `GEMINI_API_KEY` remains required unconditionally (embeddings need it regardless of `AI_PROVIDER`); this is a Boundaries-level rule already stated above and is unchanged by the split, only clarified.
- **Rationale (from user discussion, 2026-09-05):** provider-prefixed env vars (`GEMINI_API_KEY`/`GEMINI_GENERATION_MODEL` vs `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`) were confirmed over a shared generic var, specifically because embeddings must always use Gemini regardless of which generation provider is active — both keys need to coexist in `.env` at the same time, not overwrite each other on every switch.
- **Resolves the Design Notes' `ChatOpenAI` vs. `@langchain/openrouter` question, decided during implementation (2026-09-05):** stayed with `ChatOpenAI` + `configuration.baseURL` override, the spec's stated default — did **not** switch to the dedicated `@langchain/openrouter` package. `@langchain/openrouter@0.4.11`'s `peerDependencies` (`@langchain/core: ^1.0.0`) is technically satisfied by this repo's pinned `@langchain/core@1.2.9`, but its own `dependencies` field pins an *exact*, different `@langchain/openai@1.5.11` as a transitive dependency of its own — installing it would put two different `@langchain/openai` versions in the tree (this repo's explicit `@langchain/openai@1.2.9` pin, chosen because it sits exactly on this repo's pinned `@langchain/core@1.2.9`, plus `@langchain/openrouter`'s own transitive `1.5.11`), version drift with no corresponding benefit proven in this environment (no live `OPENROUTER_API_KEY` was available to verify `ChatOpenRouter`'s structured-output behavior actually is cleaner in practice, only that its README claims support). Minimizing dependency-tree surface won out; `ChatOpenAI` is also the "longer-established, better-documented path" the spec already named as the default.
- **Resolves the I/O matrix's `generateEmbedding called` row and the "Never" item 1 stub-vs-throw tension, decided during implementation (2026-09-05):** per the embedding-routing resolution above, `OpenRouterProvider` implements only `GenerationProvider` and has no `generateEmbedding` method at all (not even a throwing stub) — the I/O matrix's original "Throws a clear 'not supported'..." row is superseded by that resolution and is no longer this class's behavior. `EmbeddingProvider`/`GenerationProvider` are now two separate interfaces (`ai-provider.interface.ts`); TypeScript itself enforces that no caller can call `generateEmbedding` on something typed as a `GenerationProvider`.
- **OpenRouter 429 daily-vs-short-window classification, decided during implementation (2026-09-05):** no live `OPENROUTER_API_KEY` was available in this environment to observe a real 429 body, so `classifyOpenRouterError` (`openrouter.provider.ts`) falls back to a documented-behavior heuristic instead of a verified one: it regex-matches `/\bday\b|\bdaily\b|per[- ]day/i` against the openai-SDK error's `.error.message` text (OpenRouter's 429 body has no structured quota-kind field analogous to Gemini's `QuotaFailure.violations[].quotaId`), and reads a standard `Retry-After` header for `retryAfterSeconds` (RFC 9110 whole seconds, unlike Gemini's fractional-seconds `RetryInfo.retryDelay` string). **Risk flagged for follow-up:** this heuristic is unverified against a real OpenRouter 429 response body and should be checked against a live call before relying on it for the daily-vs-short-window distinction in production.

## Code Map

- `libs/ai/src/lib/providers/openrouter.provider.ts` (new) -- `OpenRouterProvider implements AIProvider`, constructing `new ChatOpenAI({ model, apiKey, configuration: { baseURL: 'https://openrouter.ai/api/v1' }, maxRetries: 0 })`; `generateStructuredOutput` via `.withStructuredOutput(schema).invoke(...)`, re-validated against the caller's Zod schema exactly like `gemini.provider.ts`; a `classifyOpenRouterError(err)` analogous to `classifyFetchError` in `gemini.provider.ts`.
- `libs/ai/src/lib/providers/openrouter.provider.spec.ts` (new) -- mirrors `gemini.provider.spec.ts`'s structure and error-classification matrix.
- `libs/ai/src/lib/ai-provider.factory.ts` -- add an `'openrouter'` case alongside the existing `'gemini'` case; read `OPENROUTER_API_KEY`/`OPENROUTER_MODEL` from `env`.
- `libs/ai/src/lib/ai-provider.factory.spec.ts` -- new tests for the `'openrouter'` case.
- `apps/api/.env.example` -- add `OPENROUTER_API_KEY=` and `OPENROUTER_MODEL=` with explanatory comments, mirroring the existing `GEMINI_GENERATION_MODEL` comment style.
- `package.json` -- add `@langchain/openai` at a `@langchain/core@1.2.9`-compatible version (verify during implementation).
- `libs/ai/src/lib/ai-provider.interface.ts` -- read-only; confirms `ProviderFailureKind`/`ProviderUnavailableError` are already generic enough to reuse as-is.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- add `@langchain/openai` at a compatible version
- [x] `libs/ai/src/lib/providers/openrouter.provider.ts` -- implement `OpenRouterProvider`
- [x] `libs/ai/src/lib/providers/openrouter.provider.spec.ts` -- new tests, same scenario coverage as the I/O matrix
- [x] `libs/ai/src/lib/ai-provider.factory.ts` -- add `'openrouter'` case (as `createGenerationProvider`'s switch, per the embedding-routing split)
- [x] `libs/ai/src/lib/ai-provider.factory.spec.ts` -- new tests for the `'openrouter'` case
- [x] `apps/api/.env.example` -- document `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
- [x] Resolve the embedding-routing question (Boundaries: "Never" item 1) and record the decision in the Spec Change Log
- [x] Run `nx run-many -t test --projects=ai,api` -- zero regressions (also ran `nx run-many -t test` across all 7 projects, `nx run-many -t build --projects=ai,api`, and `nx run-many -t lint --projects=ai,api`, all clean)

**Also touched, beyond the Code Map's original list, per the Spec Change Log's embedding/generation split** (each call site imported/typed a single combined `AIProvider`/`createAIProvider()` before; each now imports the specific narrower interface/factory it actually uses, no orchestration logic changed):
- `libs/ai/src/lib/ai-provider.interface.ts` -- split `AIProvider` into `EmbeddingProvider`/`GenerationProvider`
- `libs/ai/src/lib/providers/gemini.provider.ts` -- now `implements EmbeddingProvider, GenerationProvider`
- `libs/ai/src/index.ts` -- export the new provider file
- `libs/retrieval/src/lib/retrieval.ts` -- `retrieveRelevantChunks`'s `aiProvider` param retyped to `EmbeddingProvider`
- `apps/api/src/app/ai-provider.provider.ts` -- split `AI_PROVIDER`/`createAIProviderProvider` into `EMBEDDING_PROVIDER`/`createEmbeddingProviderProvider` and `GENERATION_PROVIDER`/`createGenerationProviderProvider`
- `apps/api/src/app/ask/ask.module.ts`, `ask.service.ts` -- `AskService` now injects both `EMBEDDING_PROVIDER` and `GENERATION_PROVIDER`
- `apps/api/src/app/papers/papers.module.ts`, `papers.service.ts` -- inject `EMBEDDING_PROVIDER` only (never calls `generateStructuredOutput`)
- `apps/api/src/ingest.ts`, `apps/api/src/eval-retrieval.ts`, `apps/api/src/calibrate-thresholds.ts` -- standalone scripts now call `createEmbeddingProvider()` (they only ever called `generateEmbedding`)
- Every spec file for the above (`ai-provider.factory.spec.ts`, `ai-provider.provider.spec.ts`, `ask.service.spec.ts`, `ask.http.spec.ts`, `papers.service.spec.ts`, `papers.http.spec.ts`, `retrieval.spec.ts`, `retrieval.integration.spec.ts`) -- updated fakes/tokens/types to match

**Acceptance Criteria:**
- Given `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY` set, and `OPENROUTER_MODEL` unset, when `createAIProvider()` is called, then it returns an `OpenRouterProvider` configured with the default free Nemotron model.
- Given a live `OPENROUTER_API_KEY`, when the app's existing Ask flow (`ask.service.ts`, unmodified) runs against `AI_PROVIDER=openrouter`, then it produces a grounded, cited, confidence-tiered answer exactly as it does with Gemini today -- proving the `AIProvider` seam is a true swap, no application code changes (NFR2).
- Given an OpenRouter 429/5xx response, when `generateStructuredOutput` is called, then the thrown `ProviderUnavailableError`'s `kind` matches the I/O matrix classification, same shape as `GeminiProvider`'s.

## Design Notes

OpenRouter free-tier research (2026-09-05, live query against `GET https://openrouter.ai/api/v1/models`): free Nemotron models currently offered are `nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-3.5-content-safety:free`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, and `nvidia/nemotron-3-super-120b-a12b:free`. Of these, only `nemotron-3-super-120b-a12b:free` exposes both `response_format`/`structured_outputs` and `tools`/`tool_choice` in its `supported_parameters` -- the others support tool-calling only, meaning LangChain's `.withStructuredOutput()` would fall back to its tool-calling strategy rather than native JSON mode (functional, but less deterministic for schema adherence). `nemotron-3.5-content-safety:free` has no tool support at all and is unsuitable regardless.

Free-tier rate limits are account-level, not per-model: 20 requests/minute flat, and a daily cap of 50 requests/day by default, rising to 1000/day once the account has purchased $10+ in lifetime credits (a one-time threshold -- the credits don't need to be spent). This is a materially different shape from Gemini's per-model daily quota, which is why `classifyOpenRouterError`'s daily-vs-short-window split needs its own logic rather than reusing Gemini's `isDailyQuota` detail-parsing as-is (OpenRouter's error body shape differs from `GoogleGenerativeAIFetchError`'s `QuotaFailure`/`RetryInfo` details -- verify the actual shape live during implementation rather than assuming parity).

LangChain has a dedicated `@langchain/openrouter` package (`ChatOpenRouter`) as an alternative to the generic `ChatOpenAI` + `baseURL` override; this spec defaults to the `ChatOpenAI` override since it's the longer-established, better-documented path, but implementation should check whether `@langchain/openrouter`'s version is compatible with this repo's pinned `@langchain/core@1.2.9` and prefers it if so (cleaner structured-output/tool-routing support per this story's research) -- record whichever is chosen in the Spec Change Log.

## Verification

**Commands:**
- `nx test ai` -- expect all `libs/ai` unit tests pass, including new `openrouter.provider.spec.ts`
- `nx run-many -t test --projects=ai,api` -- expect no regressions
- Manual: set `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, restart `apps/api`, ask a question through the quill widget, confirm a grounded cited answer comes back

## Suggested Review Order

**Interface split (foundation for everything else)**

- `AIProvider` splits into `EmbeddingProvider`/`GenerationProvider` -- the Spec Change Log's embedding-routing decision, made concrete.
  [`ai-provider.interface.ts:82`](../../libs/ai/src/lib/ai-provider.interface.ts#L82)

**New provider**

- `OpenRouterProvider` construction: `ChatOpenAI` + OpenRouter `baseURL` override, `maxRetries: 0`, default free Nemotron model.
  [`openrouter.provider.ts:130`](../../libs/ai/src/lib/providers/openrouter.provider.ts#L130)

- `generateStructuredOutput`: same `withStructuredOutput().invoke()` + independent Zod re-validation shape as `GeminiProvider`.
  [`openrouter.provider.ts:158`](../../libs/ai/src/lib/providers/openrouter.provider.ts#L158)

- `classifyOpenRouterError`: the openai-SDK-error-shape classifier, including the unverified daily-vs-short-window heuristic flagged in the Spec Change Log.
  [`openrouter.provider.ts:71`](../../libs/ai/src/lib/providers/openrouter.provider.ts#L71)

**Factory split**

- `createEmbeddingProvider` (always Gemini) and `createGenerationProvider` (the `AI_PROVIDER` switch, now generation-only, with the new `'openrouter'` case).
  [`ai-provider.factory.ts:14`](../../libs/ai/src/lib/ai-provider.factory.ts#L14)

**DI wiring (apps/api)**

- `EMBEDDING_PROVIDER`/`GENERATION_PROVIDER` tokens replace the single `AI_PROVIDER` token; each is its own lazily-constructed, memoized provider.
  [`ai-provider.provider.ts:14`](../../apps/api/src/app/ai-provider.provider.ts#L14)

- `AskService` now injects both tokens (it needs both methods); `PapersService`/`ingest.ts`/`eval-retrieval.ts`/`calibrate-thresholds.ts` inject/call only the embedding half.
  [`ask.service.ts:258`](../../apps/api/src/app/ask/ask.service.ts#L258)

**Dependency**

- `@langchain/openai@1.2.9` added -- exact match for this repo's pinned `@langchain/core@1.2.9`; `@langchain/openrouter` considered and rejected (Spec Change Log).

## Review Triage Log

### 2026-09-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (low)
- defer: 3 (1 medium, 2 low)
- reject: 10
- addressed_findings:
  - `[low]` `[patch]` `papers.service.ts` still named its injected `EmbeddingProvider` field `aiProvider` while every other call site in the diff was renamed to `embeddingProvider`/`generationProvider` -- renamed the field and its one call site to `embeddingProvider` for consistency; re-ran `nx run-many -t test,build,lint --projects=ai,api` (45/45 + 207/207 tests, clean build/lint) to confirm no regression.

Reviewed and rejected as non-issues (verified, not merely dismissed):
- Edge Case Hunter's "other files may still reference removed `AI_PROVIDER` token" deletion concern -- refuted by `grep -rn "createAIProvider\b\|: AIProvider\b" apps libs`, zero matches outside a historical doc comment; `ask.module.ts`/`papers.module.ts` were already updated in the reviewed diff.
- Blind Hunter's "`rate_limited_daily` kind looks inert / no consumer differentiates it" -- refuted by the Verification Gap reviewer's independent read of `ask.service.ts`'s `messageForFailureKind`, which does branch user-facing text on this exact kind.
- Blind Hunter's "`ask.service.spec.ts`'s shared fake instance can't catch embedding/generation provider mixups" -- refuted: `ask.http.spec.ts` already uses two distinct fakes (`fakeEmbeddingProvider`/`fakeGenerationProvider`, each implementing only one method), so a misrouted call would throw there.
- Intent Alignment Auditor's finding that the diff touches consumers despite the frozen intent-contract's literal "Never touch ask.service.ts/retrieval.ts" -- this Boundaries clause itself instructed "this split needs a decision during implementation -- flag it in the Spec Change Log rather than silently picking one"; the Spec Change Log entry recording that decision was written before implementation started (see above), which is the sanctioned resolution path, not an unreviewed deviation.
- Remaining Edge Case Hunter / Blind Hunter findings (empty-string `OPENROUTER_MODEL` via `??`, schema-validation failures not wrapped in `ProviderUnavailableError`, redundant constructor `apiKey` check, no `OPENROUTER_BASE_URL` env override, `.env.example` rate-limit numbers undated, test-placement nit under `createEmbeddingProvider`) -- each either mirrors `GeminiProvider`'s existing, already-shipped convention (not a new inconsistency this story introduced) or is a deliberate, already-documented design choice with no stated requirement to change it.

## Auto Run Result

**Summary:** Added `OpenRouterProvider` (`libs/ai/src/lib/providers/openrouter.provider.ts`) as a second `GenerationProvider`, backed by OpenRouter's OpenAI-compatible API via `@langchain/openai`'s `ChatOpenAI`, defaulting to the free `nvidia/nemotron-3-super-120b-a12b:free` Nemotron model (overridable via `OPENROUTER_MODEL`). Resolved this story's own flagged open question (embeddings must stay Gemini-only) by splitting `AIProvider` into `EmbeddingProvider`/`GenerationProvider` and the factory into `createEmbeddingProvider()`/`createGenerationProvider()`, propagating the narrower type to every real consumer (`AskService`, `PapersService`, `retrieveRelevantChunks`, and the three standalone scripts).

**Files changed:** see the Code Map and the "Also touched" list above under Tasks & Acceptance -- 15 non-test files, 9 test files, plus `package.json`/`package-lock.json` and `apps/api/.env.example`.

**Review findings breakdown:** 1 patch applied (low severity, naming consistency), 3 deferred (1 medium: unverified OpenRouter 429 daily-vs-short classification heuristic; 2 low: two independent GeminiProvider instances now constructed under the default gemini path, and no DI-level end-to-end test for the openrouter path), 10 rejected as non-issues after verification (see Review Triage Log for the refutation evidence on each).

**Follow-up review recommendation:** `false` (patched-finding score: 1 low = 1, below the 5 threshold; no high-severity patch).

**Verification performed:** `nx run-many -t test,build,lint --projects=ai,api` after the patch -- `ai`: 3/3 suites, 45/45 tests; `api`: 17/17 suites, 207/207 tests; build and lint clean for both. Matrix Test Audit: every I/O & Edge-Case Matrix row is covered by a passing test, except the `generateEmbedding` row, which is superseded by the interface-split decision recorded in the Spec Change Log (an `OpenRouterProvider` implementing only `GenerationProvider` has no `generateEmbedding` method to test). No live `OPENROUTER_API_KEY` was available in this environment, so the manual live-Ask-flow verification step could not be performed.

**Residual risks:** (1) the OpenRouter daily-vs-short-window 429 classification is unverified against a real API response (deferred, medium); (2) the manual end-to-end smoke test against a live OpenRouter key has not been run; (3) two independent `GeminiProvider` instances are now constructed under the default `AI_PROVIDER=gemini` path where one shared instance existed before (deferred, low, functionally harmless).
