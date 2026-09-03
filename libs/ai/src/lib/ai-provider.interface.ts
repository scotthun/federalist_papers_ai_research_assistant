import type { ZodType } from 'zod';

/**
 * Distinguishes *why* a call failed, for callers that want to message users honestly instead of
 * one generic "provider unavailable" bucket (2026-09-03, surfaced live: a 429 daily-quota
 * exhaustion and a 503 overload both used to produce the identical "high demand, try again in a
 * moment" wording, which is actively wrong for the quota case -- retrying does nothing until the
 * daily window resets). Ordered here from most to least specific/actionable, used by
 * `ask.service.ts` to pick the more informative kind when both the first attempt and the retry
 * fail with different kinds.
 *
 * - `rate_limited_daily` -- a per-day request quota is exhausted (won't recover soon; retrying
 *   now is pointless).
 * - `rate_limited_short` -- rate-limited on a shorter window (per-minute/burst); often recovers
 *   within seconds, sometimes with a provider-supplied retry delay.
 * - `overloaded` -- HTTP 503: the provider's own "high demand" signal, genuinely transient.
 * - `server_error` -- any other 5xx: an internal error on the provider's side, not evidence-
 *   related and not the caller's fault.
 * - `client_error` -- a 4xx other than 429 (e.g. 400 malformed request, 401/403 auth) -- a
 *   configuration/programming problem, not something a retry (by the user or by this app's own
 *   one-allowed-retry policy) can fix.
 * - `unavailable` -- no HTTP status at all (network failure, timeout) -- the call never reached
 *   the provider or never got a response.
 */
export type ProviderFailureKind =
  | 'rate_limited_daily'
  | 'rate_limited_short'
  | 'overloaded'
  | 'server_error'
  | 'client_error'
  | 'unavailable';

/**
 * Thrown by `generateStructuredOutput`/`generateEmbedding` implementations specifically when the
 * underlying call failed because the provider itself couldn't be reached, rejected the request,
 * or is overloaded/rate-limited (see `ProviderFailureKind`) -- never for a response the provider
 * did return that just failed schema validation or didn't satisfy the caller's own checks (e.g.
 * citation verification). That distinction matters to callers: a provider outage is not evidence
 * that the question lacks support in the corpus, and user-facing messaging should say so honestly
 * rather than implying a content/evidence problem (`GeminiProvider`'s own `catch` around
 * `structuredModel.invoke()` is the canonical example of where to throw this).
 */
export class ProviderUnavailableError extends Error {
  /** The original error thrown by the underlying provider SDK call, preserved for logging --
   *  not passed via `Error`'s own `cause` option since this lib's TS target doesn't support it. */
  readonly cause?: unknown;
  readonly kind: ProviderFailureKind;
  /** Seconds the provider itself suggested waiting before retrying (from a `RetryInfo` error
   *  detail, when present) -- `undefined` when the provider didn't supply one. */
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    kind: ProviderFailureKind,
    cause?: unknown,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderUnavailableError';
    this.kind = kind;
    this.cause = cause;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Adapter target interface every AI vendor SDK is adapted to (Adapter pattern -- stack.md's "AI
 * provider abstraction", decisions.md). No call site outside `libs/ai` ever imports a vendor SDK
 * directly; everything else depends only on this interface plus `createAIProvider()`
 * (ai-provider.factory.ts).
 *
 * `generateEmbedding()` was implemented first (Epic 1, ingestion). `generateStructuredOutput()`
 * (Epic 3, Ask-the-Archive) is the interface's generation half, added in Story 3.1 -- it collapses
 * the `generateAnswer`/`generateStructuredOutput` split this doc comment used to reserve for Epic
 * 3 into this one generic, schema-validated method; a caller that wants a grounded answer passes
 * `LlmAnswerOutputSchema` (`libs/shared`) as `schema`, but nothing about this method is
 * answer-specific.
 */
export interface AIProvider {
  /** Generates a single embedding vector for `text`. Dimension is provider/model-specific --
   *  callers that persist it (see libs/database's `document_chunks.embedding`) must already know
   *  which dimension they're pinned to. */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Generates a single structured-output response, validated against `schema` before it's ever
   * returned to the caller -- regardless of what schema hinting the underlying provider SDK
   * supports, that Zod validation is the real contract, not a formality (this story's
   * Boundaries). `systemInstruction` carries the anti-hallucination / role framing; `prompt`
   * carries the per-request question, evidence, and any retry correction. Rejects (never resolves
   * with a partially-valid or unvalidated value) if the provider's response can't be parsed as
   * JSON or doesn't satisfy `schema` even after one provider-side attempt -- callers that want a
   * corrected retry (e.g. this story's citation-verification retry policy) call this method again
   * themselves with a fresh prompt; this method never retries internally.
   */
  generateStructuredOutput<T>(params: {
    systemInstruction: string;
    prompt: string;
    schema: ZodType<T>;
  }): Promise<T>;
}
