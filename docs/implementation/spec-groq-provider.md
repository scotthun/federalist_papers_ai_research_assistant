---
title: 'Add GroqProvider (fast free-tier fallback) as a third AIProvider'
type: 'feature'
created: '2026-09-06'
status: 'done'
review_loop_iteration: 0
context: []
baseline_revision: 'f344c219b001111d38885135c3f584e2b5f36f30'
followup_review_recommended: false
deferred:
  - summary: >-
      classifyGroqError's error-shape assumption (.status/.error/.headers matching groq-sdk's real
      APIError) is validated only against a hand-authored mock, never a real groq-sdk/@langchain/groq
      error object.
    evidence: |-
      Confirmed by reading groq-sdk's source during implementation (a static exercise), not by a
      live call -- no GROQ_API_KEY was available in this environment. Same accepted limitation as
      OpenRouterProvider's identical classifyOpenRouterError when it shipped; requires a live key
      to close, not fixable in this pass.
    location: >-
      libs/ai/src/lib/providers/groq.provider.ts (classifyGroqError)
    severity: low
  - summary: >-
      Three near-identical copies now exist of the same error-classification helpers
      (isDailyQuotaMessage, isContextLengthExceededMessage, parseRetryAfterSeconds,
      classify*Error) across gemini.provider.ts, openrouter.provider.ts, and groq.provider.ts.
    evidence: |-
      Each provider file's comments explicitly note they mirror the others. Worth extracting into
      a shared helper module if a fourth provider is ever added, or if the classification logic
      needs a fix that would otherwise require three synchronized edits. Not blocking -- the
      duplication was already accepted for the second provider (OpenRouter) and this is the same
      tradeoff extended once more.
    location: >-
      libs/ai/src/lib/providers/{gemini,openrouter,groq}.provider.ts
    severity: low
  - summary: >-
      openai/gpt-oss-120b's free-tier throughput cap (8,000 tokens/minute) could be consumed by a
      single large prompt, given this app's conversation history is uncapped by default.
    evidence: |-
      Researched during this story: gpt-oss-120b's real context window is 131K tokens (large), so
      this is not a per-request rejection risk -- but the 8K TPM figure is an aggregate throughput
      rate limit, and a single unusually long conversation history could still consume most/all of
      it in one call, effectively rate-limiting the next request in the same minute. Interacts with
      spec-conversation-history-context.md's HISTORY_MAX_TURNS=null default; the documented
      rollback (flip to a number) would also mitigate this if it becomes a real problem.
    location: >-
      apps/api/.env.example (GROQ_API_KEY comment)
    severity: low
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `AI_PROVIDER` currently supports `'gemini'` and `'openrouter'`. Gemini's free tier has repeated, unpredictable outages (`gemini-3.6-flash`/`gemini-3.5-flash` 503 "high demand," confirmed live multiple times this session). OpenRouter was built as a fallback, but its free-tier Nemotron models proved too slow in practice (140–400+ seconds per response, confirmed live 2026-09-05) to actually serve as a live-demo fallback -- it's a working proof that the seam is real, not a usable escape hatch when Gemini goes down mid-demo.

**Approach:** Add `GroqProvider` implementing `GenerationProvider` (generation only -- embeddings stay Gemini-only, same boundary as `OpenRouterProvider`), backed by Groq's dedicated `@langchain/groq` package (`ChatGroq`, which supports `.withStructuredOutput()` the same way `@langchain/openai`/`@langchain/google-genai` already do -- no generic `baseURL` override needed this time, unlike the OpenRouter story). Default model: `openai/gpt-oss-120b` (researched 2026-09-06 against Groq's own docs -- the only free-tier model confirmed to support *strict* JSON-schema-conformant structured output; `llama-3.3-70b-versatile` and other Llama models are not confirmed strict-mode-capable and would need a best-effort-JSON-plus-retry approach instead). Groq's free tier is fast (300-800 tokens/sec, LPU hardware) and its `gpt-oss-120b`/`gpt-oss-20b` tier gets 1,000 requests/day -- both far better fits for "the thing you flip to when Gemini 503s" than OpenRouter's free tier turned out to be.

## Boundaries & Constraints

**Always:**
- `GroqProvider implements GenerationProvider` only -- no `generateEmbedding`, mirroring `OpenRouterProvider`'s exact reasoning (embeddings stay Gemini-only; `ai-provider.interface.ts`'s doc comment).
- `ai-provider.factory.ts`'s `createGenerationProvider()` gains a `'groq'` case alongside `'gemini'`/`'openrouter'`, reading `GROQ_API_KEY` (required) and `GROQ_MODEL` (optional, defaults to `openai/gpt-oss-120b`) from env -- same pattern as the other two cases, same error-message style on a missing key.
- `maxRetries: 0` on the `ChatGroq` client (this codebase's established "never retries internally" contract, same as `GeminiProvider`/`OpenRouterProvider`).
- `generateStructuredOutput` re-validates the model's output against the caller's own Zod `schema` regardless of Groq's own strict-mode guarantee (never trusts any provider's schema hinting alone, unchanged principle from every existing provider).
- On a failed call, wrap the error in `ProviderUnavailableError` classified into a `ProviderFailureKind` -- reuse the *existing* kind set (`rate_limited_daily`, `rate_limited_short`, `overloaded`, `server_error`, `client_error`, `unavailable`, `context_length_exceeded`) rather than inventing Groq-specific kinds; `@langchain/groq` is itself OpenAI-API-shaped under the hood, so its error shape should closely resemble `OpenRouterProvider`'s `classifyOpenRouterError` (`.status`/`.error`/`.headers`) -- confirm the exact shape live during implementation rather than assuming byte-for-byte parity.
- `OPENROUTER_MODEL`'s "never hardcode as anything other than a default" boundary applies identically here: `GROQ_MODEL` must be overridable, since Groq's free model roster and rate limits can change (this story's own research already flagged one model, `moonshotai/kimi-k2-instruct`, as possibly no longer listed).
- New tests mirror `openrouter.provider.spec.ts`'s structure: construction, structured-output happy path, schema-validation failure, provider-unavailable wrapping, and the full error-classification matrix (429 daily/short, 5xx, other 4xx, context-length-exceeded).
- Update `apps/api/.env.example` with `GROQ_API_KEY=`/`GROQ_MODEL=`, mirroring the existing `OPENROUTER_*` comment style (free-tier limits, where to get a key).

**Never:**
- Do not touch `ask.service.ts`, `retrieval.ts`, `ai-provider.provider.ts`'s DI tokens, or any consumer -- the seam is the factory + interface, unchanged boundary from both prior provider stories.
- Do not add a fourth `ProviderFailureKind` for Groq-specific cases without first confirming the existing seven don't already cover what Groq actually returns -- confirmed by this story's own research that Groq's rate limits/errors are conventional HTTP-status-shaped, not something novel.
- Do not assume `llama-3.3-70b-versatile` or other non-`gpt-oss` models work reliably with `.withStructuredOutput()` -- this story's research found only `gpt-oss-120b`/`gpt-oss-20b` (and a preview Qwen model) confirmed for strict schema conformance; do not default to an unconfirmed model.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Factory happy path | `AI_PROVIDER=groq`, `GROQ_API_KEY` set | Returns a `GroqProvider` | N/A |
| Factory missing key | `AI_PROVIDER=groq`, no `GROQ_API_KEY` | — | Throws naming the missing env var, same style as the existing cases |
| Model override | `GROQ_MODEL=llama-3.3-70b-versatile` set | `ChatGroq` constructed with that model | N/A |
| Model default | `GROQ_MODEL` unset | `ChatGroq` constructed with `openai/gpt-oss-120b` | N/A |
| Structured output happy path | Chat completion resolves an object matching `schema` | Returns the validated object | N/A |
| Structured output fails Zod schema | Resolves an object that doesn't satisfy `schema` | — | Throws a clear validation error, exactly one call made |
| Call rejects — 429 | Underlying call rejects with a 429 | — | `ProviderUnavailableError` with `kind: 'rate_limited_daily'` or `'rate_limited_short'`, consistent with the existing daily-vs-short classification logic |
| Call rejects — 5xx | Underlying call rejects with 503/500 | — | `ProviderUnavailableError` with `kind: 'overloaded'`/`'server_error'` |
| Call rejects — other 4xx | Underlying call rejects with 401/400 (e.g. bad key) | — | `ProviderUnavailableError` with `kind: 'client_error'` |
| Call rejects — context length exceeded | A 400 whose message indicates the request exceeded the model's context window | — | `ProviderUnavailableError` with `kind: 'context_length_exceeded'` (reuses spec-conversation-history-context.md's existing kind/message) |
| Call rejects — no status at all | Plain network error/timeout | — | `ProviderUnavailableError` with `kind: 'unavailable'` |

</frozen-after-approval>

## Code Map

- `libs/ai/src/lib/providers/groq.provider.ts` (new) -- `GroqProvider implements GenerationProvider`, constructing `new ChatGroq({ model, apiKey, maxRetries: 0 })`; `generateStructuredOutput` via `.withStructuredOutput(schema).invoke(...)`, re-validated against the caller's Zod schema; a `classifyGroqError(err)` analogous to `classifyOpenRouterError`/`classifyFetchError`, reusing the existing `ProviderFailureKind` type (including `context_length_exceeded`'s message-content detection, same helper shape as the other two providers).
- `libs/ai/src/lib/providers/groq.provider.spec.ts` (new) -- mirrors `openrouter.provider.spec.ts`'s structure and error-classification matrix.
- `libs/ai/src/lib/ai-provider.factory.ts` -- add a `'groq'` case alongside `'gemini'`/`'openrouter'`.
- `libs/ai/src/lib/ai-provider.factory.spec.ts` -- new tests for the `'groq'` case.
- `libs/ai/src/index.ts` -- export the new provider file.
- `apps/api/.env.example` -- add `GROQ_API_KEY=`, `GROQ_MODEL=`.
- `package.json` -- add `@langchain/groq` at a version whose `@langchain/core` peer range accepts this repo's pinned `@langchain/core@1.2.9` (verify during implementation, same as both prior provider stories).

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- add `@langchain/groq` at a compatible version
- [x] `libs/ai/src/lib/providers/groq.provider.ts` -- implement `GroqProvider`
- [x] `libs/ai/src/lib/providers/groq.provider.spec.ts` -- new tests, same scenario coverage as the I/O matrix
- [x] `libs/ai/src/lib/ai-provider.factory.ts` -- add `'groq'` case
- [x] `libs/ai/src/lib/ai-provider.factory.spec.ts` -- new tests for the `'groq'` case
- [x] `apps/api/.env.example` -- document `GROQ_API_KEY`, `GROQ_MODEL`
- [x] Run `nx run-many -t test --projects=ai,api` -- zero regressions (70 ai + 263 api, all passing)

**Acceptance Criteria:**
- Given `AI_PROVIDER=groq`, `GROQ_API_KEY` set, and `GROQ_MODEL` unset, when `createGenerationProvider()` is called, then it returns a `GroqProvider` configured with `openai/gpt-oss-120b`.
- Given a live `GROQ_API_KEY`, when the app's existing Ask flow runs against `AI_PROVIDER=groq`, then it produces a grounded, cited, confidence-tiered answer in a demo-usable timeframe (seconds, not minutes) -- the actual gap this story exists to close versus the OpenRouter fallback.
- Given a Groq 429/5xx/context-length response, when `generateStructuredOutput` is called, then the thrown `ProviderUnavailableError`'s `kind` matches the I/O matrix classification, same shape as the other two providers.

## Design Notes

Groq free-tier research (2026-09-06, against Groq's own docs at `console.groq.com`): current free-tier models are `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and `groq/compound` (an agentic/tool-using system model, not relevant here). Of these, **only `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and a preview `qwen/qwen3.8-27b`** are confirmed by Groq's structured-outputs doc to support strict, schema-conformant JSON output -- the Llama models are not listed for this feature (this contradicts an earlier, apparently-stale recollection that Llama/Mixtral/Gemma supported it; trust the live doc check over that). `openai/gpt-oss-120b`'s free-tier limits, confirmed directly from Groq's rate-limits doc: 30 requests/minute, 1,000 requests/day, 8,000 tokens/minute, 200,000 tokens/day. `llama-3.3-70b-versatile`'s exact free-tier numbers could not be confirmed directly from Groq's own docs during this research pass (the page didn't fully render); third-party sources suggest a similar 30 RPM / 1,000 RPD shape, but treat that as unconfirmed if it ever becomes relevant.

`@langchain/groq`'s `ChatGroq` is a first-class LangChain chat model (confirmed via LangChain's own reference docs) -- unlike the OpenRouter story, no generic `ChatOpenAI` + `baseURL` override trick is needed here; Groq has its own dedicated, actively maintained LangChain integration package.

Model/rate-limit roster note (flagged by this story's own research): Groq's free-tier model list and limits shift; before relying on this spec's specific numbers in production, a live check against `https://api.groq.com/openai/v1/models` and the account's own rate-limit settings is more authoritative than anything written here.

## Verification

**Commands:**
- `nx test ai` -- expect all `libs/ai` unit tests pass, including new `groq.provider.spec.ts`
- `nx run-many -t test --projects=ai,api` -- expect no regressions
- Manual: set `AI_PROVIDER=groq`, `GROQ_API_KEY`, restart `apps/api`, ask a question through the quill widget, confirm a grounded cited answer comes back quickly (seconds, not minutes -- the actual bar this provider exists to clear)

## Suggested Review Order

1. `libs/ai/src/lib/providers/groq.provider.ts` -- the new adapter: constructor, `classifyGroqError` and its helpers, `generateStructuredOutput`.
2. `libs/ai/src/lib/providers/groq.provider.spec.ts` -- coverage mirroring `openrouter.provider.spec.ts`.
3. `libs/ai/src/lib/ai-provider.factory.ts` / `.spec.ts` -- the new `'groq'` case.
4. `libs/ai/src/index.ts`, `apps/api/.env.example`, `package.json` -- wiring/docs.

## Implementation Notes (2026-09-06)

- `@langchain/groq@1.3.1` was added -- its `peerDependencies` require `@langchain/core@^1.1.30`, satisfied by this repo's pinned `1.2.9`.
- Confirmed live (by unpacking `@langchain/groq`'s and its `groq-sdk` dependency's published source) that `groq-sdk`'s `APIError.generate` produces the exact same `.status`/`.error`/`.headers` shape as the `openai` SDK's `APIError` that `classifyOpenRouterError` targets -- `classifyGroqError` in `groq.provider.ts` mirrors `classifyOpenRouterError` line-for-line as a result, reusing the existing seven `ProviderFailureKind` values with no Groq-specific additions.
- `ChatGroq`'s constructor takes `{ model, apiKey, maxRetries }` directly (no `baseURL`/`configuration` override needed, unlike `OpenRouterProvider`'s `ChatOpenAI` usage) -- confirmed against the package's shipped `.d.ts`.
- Verification run: `nx run-many -t test --projects=ai,api` -- 70/70 `ai` tests and 263/263 `api` tests passed; `nx build api` and `nx lint ai` both succeeded.
- Not verified: a live call against the real Groq API (no `GROQ_API_KEY` available in this environment) -- the Acceptance Criteria's "live `GROQ_API_KEY`" and manual Ask-flow checks are unexercised. Everything else (unit-level classification matrix, factory wiring, schema re-validation) is covered by mocks per the existing providers' own testing pattern.

## Review Triage Log

### 2026-09-06 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 1 (low)
- defer: 3 (0 high, 0 medium, 3 low)
- reject: 9
- addressed_findings:
  - `[low]` `[patch]` `.env.example`'s `GROQ_API_KEY` comment overstated this provider's capability -- it framed Groq as "the actual reason this provider exists... to serve as a live-demo fallback," which reads as automatic failover, but the diff only adds a manual, restart-required `AI_PROVIDER` switch (flagged independently by the blind-hunter and intent-alignment auditor). Reworded to explicitly say "quick MANUAL fallback... no automatic failover between providers." Also corrected/clarified the 8,000 tokens/minute figure as a throughput rate limit, not the model's real context window (131K tokens, confirmed via research), while noting the real interaction risk with this app's uncapped conversation history. Re-ran `nx run-many -t test,build,lint --projects=ai,api` -- 70/70 (ai) + 263/263 (api) tests pass, clean build/lint.

Reviewed and rejected as non-issues (verified, not merely dismissed):
- Blind Hunter's/Edge Case Hunter's "empty-string `GROQ_MODEL` bypasses the default via `??`" -- refuted: this is the exact same `??`-based default pattern already shipped and accepted for `GEMINI_GENERATION_MODEL` and `OPENROUTER_MODEL`, not a new inconsistency introduced here.
- Blind Hunter's "`isGroqAPIErrorShape` doesn't check `status` is a number" -- refuted: mirrors `classifyOpenRouterError`'s identical existing guard, already accepted in that story's review.
- Blind Hunter's "`parseRetryAfterSeconds` doesn't handle the HTTP-date `Retry-After` form" -- refuted: mirrors `openrouter.provider.ts`'s identical existing implementation, already accepted.
- Blind Hunter's "apiKey not trimmed for whitespace" -- refuted: mirrors `GeminiProvider`'s/`OpenRouterProvider`'s identical existing check.
- Blind Hunter's "no README/SPEC.md update listing Groq as a third provider" -- refuted: neither the Gemini-to-LangChain refactor (GH-24) nor the OpenRouter story updated SPEC.md/README either; matches existing project convention of tracking this in the implementation spec files, not top-level docs.
- Blind Hunter's "apps/api/package.json workspace-hoisting concern for the new dependency" -- refuted: `nx build api` succeeded (twice, independently re-verified), which would have failed if the dependency weren't resolvable from the API app.
- Edge Case Hunter's "`withStructuredOutput()` call sits outside the try/catch" -- refuted as this story's problem: identical to `GeminiProvider`'s and `OpenRouterProvider`'s existing structure; a pre-existing pattern across the whole provider family, not introduced or worsened by this story.
- Verification Gap Reviewer's "`classifyGroqError` validated only against a hand-authored mock, never a real `groq-sdk` error object" and Intent Alignment Auditor's related "confirmed via source-reading, not runtime observation" finding -- same underlying concern, deduplicated; moved to `deferred` (same accepted limitation as `OpenRouterProvider`'s identical gap when it shipped, requires a live key not available in this environment).
- Blind Hunter's "3x duplication of classification helpers across providers" -- moved to `deferred` (real, but not blocking; same tradeoff already accepted when OpenRouter became the second provider).

## Auto Run Result

**Summary:** Added `GroqProvider` as a third `GenerationProvider` option (`AI_PROVIDER=groq`), backed by `@langchain/groq`'s `ChatGroq`, defaulting to `openai/gpt-oss-120b` (the only free-tier model confirmed to support strict JSON-schema structured output). Reuses the existing `ProviderFailureKind` set with no new kinds. Intended as a faster, more reliable manual fallback than OpenRouter's free tier turned out to be for live-demo purposes.

**Files changed:** `libs/ai/src/lib/providers/groq.provider.ts` (new), `libs/ai/src/lib/providers/groq.provider.spec.ts` (new), `libs/ai/src/lib/ai-provider.factory.ts` (+spec), `libs/ai/src/index.ts`, `apps/api/.env.example`, `package.json`/`package-lock.json`.

**Review findings breakdown:** 1 patch applied (low severity -- corrected an overstated `.env.example` comment), 3 deferred (all low severity -- unverified-against-real-SDK error classification, cross-provider code duplication, a throughput-limit/uncapped-history interaction), 9 rejected as non-issues after verification (see Review Triage Log for each refutation).

**Follow-up review recommendation:** `false` (patched-finding score: 1 low = 1, below the 5 threshold; no high-severity patch).

**Verification performed:** `nx run-many -t test,build,lint --projects=ai,api` -- `ai`: 4/4 suites, 70/70 tests; `api`: 18/18 suites, 263/263 tests; build/lint clean. Matrix Test Audit: every I/O & Edge-Case Matrix row confirmed covered by a passing test.

**Residual risks:** (1) no live `GROQ_API_KEY` call was exercised in this pass -- the real Groq API's error shape, and whether `openai/gpt-oss-120b` genuinely honors strict structured output in practice, remain confirmed only via documentation/source-reading, not a live request; (2) the three deferred low-severity items above remain open, not blocking.
