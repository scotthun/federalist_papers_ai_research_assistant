---
title: 'GH-24: Reimplement GeminiProvider on LangChain.js'
type: 'refactor'
created: '2026-08-28'
status: 'done'
review_loop_iteration: 0
context: []
baseline_commit: 'fa98c8ec0218cdf690c0575ff430b3f3bc4d0a5e'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The architecture spine (`stack.md`, `ARCHITECTURE-SPINE.md`) always specified LangChain.js as the AI layer, precisely so the app could swap vendors without touching application code. `GeminiProvider` (`libs/ai`) was implemented directly against `@google/genai` instead, deviating from that decision (GitHub issue #24). Both Ask-the-Archive and semantic search depend on this one class at runtime, so the deviation is architecturally significant even though no other file imports the vendor SDK.

**Approach:** Reimplement `GeminiProvider`'s internals on `@langchain/google-genai` (`ChatGoogleGenerativeAI` + `.withStructuredOutput()` for generation, `GoogleGenerativeAIEmbeddings.embedQuery()` for embeddings). `AIProvider` (the interface) and `createAIProvider()` (the factory) — the actual "swap the engine" seam — do not change at all; LangChain becomes an implementation detail of one adapter class, exactly like `@google/genai` is today.

## Boundaries & Constraints

**Always:**
- `AIProvider`'s two method signatures and `ai-provider.factory.ts`'s env-var contract (`AI_PROVIDER`, `GEMINI_API_KEY`, `'gemini'` case, error messages) are unchanged.
- Same models: `gemini-embedding-001` (3072-dim embeddings) and `gemini-3.6-flash` (generation) — do not drift versions.
- `generateEmbedding` still fails fast naming both dimensions on a mismatch.
- `generateStructuredOutput` still re-validates the model's output against the caller's own Zod `schema` (never trusts LangChain's schema hinting alone) and never retries internally — one model call per invocation.
- Add `langchain@1.5.10`, `@langchain/core@1.2.8` (pinned in `ARCHITECTURE-SPINE.md`) and `@langchain/google-genai@2.1.31` (verified during planning: the newest 2.x release whose `@langchain/core` peer range — `^1.1.47` — still accepts the pinned `1.2.8`) to `package.json`; remove `@google/genai`.
- Update `gemini.provider.spec.ts` and `ai-provider.factory.spec.ts` to mock the LangChain classes instead of `@google/genai`, preserving equivalent coverage of every current scenario (exact error wording may change; the guarantees must not).

**Never:**
- Do not touch `ai-provider.interface.ts` or any consumer (`ask.service.ts`, `papers.service.ts`, `retrieval.ts`, ingestion/eval scripts) — confirmed during planning that none import a vendor SDK or `GeminiProvider` directly.
- Do not add a second concrete provider (e.g. OpenAI) — out of scope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Embed happy path | `embedQuery` resolves a 3072-length array | Returns that array | N/A |
| Embed wrong dimension | `embedQuery` resolves an array of the wrong length | — | Throws naming expected vs. actual length |
| Embed empty/rejected | `embedQuery` resolves `[]` or rejects | — | Throws "no embedding values" / propagates rejection as-is |
| Structured output happy path | `withStructuredOutput(schema).invoke(...)` resolves an object matching `schema` | Returns the validated object | N/A |
| Structured output fails Zod schema | Resolves an object that doesn't satisfy `schema` | — | Throws a clear validation error, exactly one call made |
| Structured output unusable/rejected | Resolves with no parseable content, or the underlying call rejects | — | Throws a clear error / propagates rejection as-is, exactly one call made |

</frozen-after-approval>

## Code Map

- `libs/ai/src/lib/providers/gemini.provider.ts` -- rewrite internals: construct `new ChatGoogleGenerativeAI({ model: GENERATION_MODEL, apiKey })` and `new GoogleGenerativeAIEmbeddings({ model: EMBEDDING_MODEL, apiKey })` in place of `GoogleGenAI`; `generateEmbedding` → `.embedQuery(text)`; `generateStructuredOutput` → `chatModel.withStructuredOutput(params.schema).invoke([["system", params.systemInstruction], ["human", params.prompt]])`, with a thin wrapper preserving the existing thrown-error contract.
- `libs/ai/src/lib/providers/gemini.provider.spec.ts` -- replace the `jest.mock('@google/genai', ...)` block with mocks of `ChatGoogleGenerativeAI`/`GoogleGenerativeAIEmbeddings` (mock `invoke`/`embedQuery`, and `withStructuredOutput` to return an object exposing a mocked `invoke`).
- `libs/ai/src/lib/ai-provider.factory.spec.ts` -- swap its (currently vestigial) `@google/genai` mock for a `@langchain/google-genai` one; assertions unchanged.
- `libs/ai/src/lib/ai-provider.interface.ts`, `libs/ai/src/lib/ai-provider.factory.ts` -- read-only; confirms the doc comments' "regardless of what schema hinting the underlying SDK supports" claim still holds.
- `package.json` -- dependency swap described above.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` -- remove `@google/genai`, add `langchain@1.5.10`, `@langchain/core@1.2.9`, `@langchain/google-genai@2.1.31` -- restores the architecture-mandated stack (see Spec Change Log: `@langchain/core` pin bumped from `1.2.8`)
- [x] `libs/ai/src/lib/providers/gemini.provider.ts` -- reimplement both methods on LangChain -- closes GH-24
- [x] `libs/ai/src/lib/providers/gemini.provider.spec.ts` -- new LangChain-targeted mocks, same scenario coverage as the I/O matrix
- [x] `libs/ai/src/lib/ai-provider.factory.spec.ts` -- new mock target, same assertions
- [x] Run `nx run-many -t test --projects=ai,api,retrieval` -- zero regressions in ask/search consumers

**Acceptance Criteria:**
- Given `AI_PROVIDER=gemini` and `GEMINI_API_KEY` set, when `createAIProvider()` is called, then it returns a `GeminiProvider` whose external behavior (inputs/outputs/thrown errors) is unchanged from before the refactor.
- Given the refactor is complete, when grepping the repo (excluding `node_modules`) for `@google/genai`, then there are zero matches.
- Given the updated `gemini.provider.spec.ts` and `ai-provider.factory.spec.ts`, when run, then all tests pass without touching any file outside `libs/ai`.

## Spec Change Log

- **`@langchain/core` pin: `1.2.8` → `1.2.9`.** `npm install` proved `langchain@1.5.10`'s own `peerDependencies` require `@langchain/core@^1.2.9` (not `^1.2.8` as `ARCHITECTURE-SPINE.md`'s stack table currently states); `1.2.8` cannot be installed alongside `langchain@1.5.10` without forcing an npm peer-conflict override, which would leave an unverified/likely-broken resolution in place. `1.2.9` is the minimal version satisfying that peer range, resolves cleanly with `@langchain/google-genai@2.1.31`'s own `^1.1.47` peer range, and all `libs/ai` tests plus `nx run-many -t test --projects=ai,api,retrieval` (172 tests) pass against it. `ARCHITECTURE-SPINE.md`'s stack table should be corrected to `1.2.9` in a follow-up (out of this spec's file scope, which is `libs/ai` only).
- **Post-review patch fixes (review round 1):**
  1. `gemini.provider.ts` -- added `maxRetries: 0` to both the `ChatGoogleGenerativeAI` and `GoogleGenerativeAIEmbeddings` constructor options. `@langchain/core`'s `AsyncCaller` (`utils/async_caller`) defaults `maxRetries` to `6` and retries transient errors internally by default; left unset, this silently violated the frozen Boundaries' "never retries internally -- one model call per invocation" at runtime (mocked tests couldn't catch this since the mocks bypass `AsyncCaller` entirely). This is a real behavioral regression introduced by the LangChain swap -- the prior `@google/genai`-based implementation had no such built-in retry wrapper.
  2. `gemini.provider.spec.ts` -- added `expect(invoke).toHaveBeenCalledTimes(1)` to the "does not satisfy the Zod schema" test, restoring the I/O matrix's "exactly one call made" coverage for the resolved-but-schema-invalid scenario (previously only the rejected-invoke scenario asserted a call count, which is a different matrix row).

## Design Notes

`ChatGoogleGenerativeAI.withStructuredOutput(zodSchema)` returns a `Runnable` whose `.invoke()` does the JSON-schema hinting + parse + Zod-validate in one idiomatic LangChain call — this is the standard LangChain structured-output pattern (not a thin pass-through), matching the project's stated goal of visibly using LangChain rather than nominally depending on it. `GoogleGenerativeAIEmbeddings` has no output-dimensionality parameter (only `embedding-001`-era models expose one upstream), so the existing post-hoc 3072-dimension assertion stays load-bearing exactly as it is today.

`@langchain/google-genai` itself depends on the older `@google/generative-ai` SDK internally — that's fully encapsulated inside the package and never imported by our code, same as `@google/genai` is fully encapsulated inside `gemini.provider.ts` today.

## Verification

**Commands:**
- `nx test ai` -- expect all `libs/ai` unit tests pass
- `nx run-many -t test --projects=ai,api,retrieval` -- expect no regressions
- `grep -rn "@google/genai" --include="*.ts" --include="package.json" . --exclude-dir=node_modules` -- expect zero matches

## Suggested Review Order

**Provider reimplementation**

- Entry point: the adapter class now wraps two LangChain clients instead of one `@google/genai` client.
  [`gemini.provider.ts:25`](../../libs/ai/src/lib/providers/gemini.provider.ts#L25)

- Embeddings now go through `.embedQuery()`, with the same fail-fast dimension check as before.
  [`gemini.provider.ts:49`](../../libs/ai/src/lib/providers/gemini.provider.ts#L49)

- Generation now uses `withStructuredOutput().invoke()`, still independently re-validated against the caller's Zod schema.
  [`gemini.provider.ts:77`](../../libs/ai/src/lib/providers/gemini.provider.ts#L77)

**Retry contract (review fix)**

- `maxRetries: 0` on both clients -- without this, `@langchain/core`'s `AsyncCaller` silently retries transient errors up to 6 times, violating the "one call per invocation" contract.
  [`gemini.provider.ts:33`](../../libs/ai/src/lib/providers/gemini.provider.ts#L33)

**Dependency swap**

- `@google/genai` removed; `@langchain/core`, `@langchain/google-genai` added.
  [`package.json:64`](../../package.json#L64)

- `langchain` added per `ARCHITECTURE-SPINE.md`'s stack table -- currently unused directly, kept for planned future chain/agent work.
  [`package.json:74`](../../package.json#L74)

**Test coverage**

- Mocks now target `ChatGoogleGenerativeAI`/`GoogleGenerativeAIEmbeddings` instead of `@google/genai`'s `GoogleGenAI`.
  [`gemini.provider.spec.ts:1`](../../libs/ai/src/lib/providers/gemini.provider.spec.ts#L1)

- Schema-validation-failure test now also asserts exactly one call, closing the review-round-1 coverage gap.
  [`gemini.provider.spec.ts:133`](../../libs/ai/src/lib/providers/gemini.provider.spec.ts#L133)

- Factory test's vestigial SDK mock retargeted; assertions unchanged.
  [`ai-provider.factory.spec.ts:1`](../../libs/ai/src/lib/ai-provider.factory.spec.ts#L1)
