import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import type { ZodType } from 'zod';
import {
  ProviderUnavailableError,
  type EmbeddingProvider,
  type GenerationProvider,
  type ProviderFailureKind,
} from '../ai-provider.interface';

/** Loose shape of the `@google/generative-ai` SDK's `GoogleGenerativeAIFetchError` -- imported as
 *  a type-only structural check rather than the real class (which `@langchain/google-genai`
 *  re-throws verbatim, confirmed live: its own `completionWithRetry` only ever `throw`s the same
 *  object it caught, occasionally patching `.status`). Declared locally instead of depending on
 *  `@google/generative-ai` directly -- that package is `@langchain/google-genai`'s own transitive
 *  dependency, never a direct one of this lib's, and this shape is all `classifyFetchError` below
 *  actually needs from it. */
interface GoogleGenerativeAIFetchErrorShape {
  status?: number;
  errorDetails?: Array<{ '@type'?: string; [key: string]: unknown }>;
}

function isFetchErrorShape(err: unknown): err is GoogleGenerativeAIFetchErrorShape {
  return typeof err === 'object' && err !== null && 'status' in err;
}

/** Parses a `RetryInfo` detail's `retryDelay` (e.g. `"18s"`, `"1.5s"`) into whole seconds,
 *  rounding up so a caller never under-waits. `undefined` when absent/unparseable. */
function parseRetryAfterSeconds(
  errorDetails: GoogleGenerativeAIFetchErrorShape['errorDetails'],
): number | undefined {
  const retryInfo = errorDetails?.find(
    (detail) => detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo',
  );
  const retryDelay = retryInfo?.['retryDelay'];
  if (typeof retryDelay !== 'string') {
    return undefined;
  }
  const seconds = Number.parseFloat(retryDelay.replace(/s$/, ''));
  return Number.isFinite(seconds) ? Math.ceil(seconds) : undefined;
}

/** `true` when a 429's `QuotaFailure` detail names a *per-day* quota (e.g.
 *  `GenerateRequestsPerDayPerProjectPerModel-FreeTier`) rather than a shorter-window one --
 *  the distinction that actually matters to a user ("come back tomorrow" vs "wait a few
 *  seconds"), confirmed live 2026-09-03 against a real 20-requests/day free-tier rejection. */
function isDailyQuota(errorDetails: GoogleGenerativeAIFetchErrorShape['errorDetails']): boolean {
  const quotaFailure = errorDetails?.find(
    (detail) => detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure',
  );
  const violations = quotaFailure?.['violations'];
  if (!Array.isArray(violations)) {
    return false;
  }
  return violations.some(
    (violation) =>
      typeof violation === 'object' &&
      violation !== null &&
      typeof (violation as { quotaId?: unknown }).quotaId === 'string' &&
      /PerDay/i.test((violation as { quotaId: string }).quotaId),
  );
}

/** `true` when the error's own message indicates the request (question + evidence + conversation
 *  history) exceeded the model's context window -- Gemini returns a plain 400 for this with no
 *  dedicated status/error-detail shape of its own (spec-conversation-history-context.md), so this
 *  is message-content matching rather than a structured field, mirroring `isDailyQuota`'s own
 *  fallback-to-wording approach for the same reason. Deliberately broad (matches any of several
 *  wordings a provider might use) so a reworded-but-still-context-length message doesn't silently
 *  fall through to the generic `client_error` bucket, which would tell the user "a developer
 *  needs to look at this" for something they can fix themselves by clearing the chat. */
function isContextLengthExceededMessage(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /context length|context window|token limit|maximum.*tokens|context_length_exceeded/i.test(
    message,
  );
}

/** Classifies a caught error into a `ProviderFailureKind` + optional retry hint, from whatever
 *  HTTP status/error-detail metadata is available -- `err` may not even be a real HTTP error at
 *  all (a plain network failure/timeout has no `.status`), so every field here is read
 *  defensively rather than assumed present. */
function classifyFetchError(err: unknown): {
  kind: ProviderFailureKind;
  retryAfterSeconds?: number;
} {
  if (!isFetchErrorShape(err) || err.status === undefined) {
    return { kind: 'unavailable' };
  }
  const { status, errorDetails } = err;
  if (status === 429) {
    return {
      kind: isDailyQuota(errorDetails) ? 'rate_limited_daily' : 'rate_limited_short',
      retryAfterSeconds: parseRetryAfterSeconds(errorDetails),
    };
  }
  if (status === 503) {
    return { kind: 'overloaded' };
  }
  if (status >= 500) {
    return { kind: 'server_error' };
  }
  // A context-length-exceeded rejection is itself a 4xx (usually 400) -- checked before the
  // generic 4xx fallback below so it isn't misclassified as a config problem the user can't fix.
  if (isContextLengthExceededMessage(err)) {
    return { kind: 'context_length_exceeded' };
  }
  // Any other 4xx (400 malformed request, 401/403 auth/permission) -- a configuration/
  // programming problem, not something transient. Still classified (not rethrown as-is): the
  // confident tier's own documented contract is "never throws, always fails safe to refuse"
  // (this story's Boundaries) -- this just makes sure the refuse message tells the truth about
  // *why* instead of implying "high demand" for what's actually a broken setup.
  return { kind: 'client_error' };
}

// Verified live against the Gemini API (Story 0.1 spike, 2026-08-24): gemini-embedding-001
// returns 3072-dimensional embeddings by default. libs/database's `document_chunks.embedding`
// column is pinned to exactly this dimension -- changing it is a deliberate, separately-costed
// migration (decisions.md), not something this adapter should silently vary.
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSION = 3072;

// gemini-2.5-flash returns 404 for new API keys as of 2026-08 ("no longer available to new
// users"); the API's own error pointed at this replacement (Story 0.1 spike, confirmed live
// again for this story). Overridable via GeminiProviderOptions.generationModel/
// GEMINI_GENERATION_MODEL (2026-09-03) -- swapping models to work around a specific model's
// live availability (observed both `gemini-3.6-flash` and `gemini-3.5-flash` returning 503
// "high demand" the same day) previously meant editing this source constant.
const DEFAULT_GENERATION_MODEL = 'gemini-3.6-flash';

export interface GeminiProviderOptions {
  apiKey: string;
  /** Overrides `DEFAULT_GENERATION_MODEL`. See `GEMINI_GENERATION_MODEL` in `.env.example`. */
  generationModel?: string;
}

/** Concrete Adapter wrapping `@langchain/google-genai` behind the `EmbeddingProvider`/
 *  `GenerationProvider` interfaces -- the one initial provider (stack.md: "implement at least one
 *  provider initially"), and the only one implementing both (embeddings stay Gemini-only --
 *  `ai-provider.interface.ts`'s doc comment). LangChain.js is the architecture-mandated AI layer
 *  (ARCHITECTURE-SPINE.md); it is an implementation detail of this one adapter class, never
 *  imported by any consumer outside `libs/ai` (GH-24). */
export class GeminiProvider implements EmbeddingProvider, GenerationProvider {
  private readonly chatModel: ChatGoogleGenerativeAI;
  private readonly embeddings: GoogleGenerativeAIEmbeddings;

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey) {
      throw new Error('GeminiProvider requires a non-empty apiKey');
    }
    // maxRetries: 0 -- @langchain/core's AsyncCaller otherwise defaults to 6 silent internal
    // retries on transient errors, which would violate this method's "never retries internally
    // -- one model call per invocation" contract at runtime (the caller's own retry policy, e.g.
    // this story's citation-verification retry, is the only place a retry is allowed to happen).
    this.chatModel = new ChatGoogleGenerativeAI({
      // `?.trim() || DEFAULT...` (not `??`) -- a blank/whitespace GEMINI_GENERATION_MODEL (e.g. an
      // env var left present-but-empty on Vercel rather than removed entirely, confirmed live:
      // GoogleGenerativeAIError "Must provide a model name") is `''`, not `undefined`/`null`, so
      // `??` alone would pass it straight through. Same blank-treated-as-unset convention as
      // `resolveCorsOrigin` (Story 4.1).
      model: options.generationModel?.trim() || DEFAULT_GENERATION_MODEL,
      apiKey: options.apiKey,
      maxRetries: 0,
    });
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      model: EMBEDDING_MODEL,
      apiKey: options.apiKey,
      maxRetries: 0,
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const values = await this.embeddings.embedQuery(text);
    if (!values || values.length === 0) {
      throw new Error('Gemini returned no embedding values');
    }
    // If Gemini ever changed gemini-embedding-001's default output dimensionality, this would
    // otherwise only surface much later as an opaque Postgres vector(3072) dimension-mismatch
    // error -- fail here instead, naming both the expected and actual length.
    if (values.length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Gemini returned an embedding with ${values.length} dimensions, expected ${EMBEDDING_DIMENSION}`,
      );
    }
    return values;
  }

  /**
   * Implements `AIProvider.generateStructuredOutput` via LangChain's standard structured-output
   * pattern: `ChatGoogleGenerativeAI.withStructuredOutput(schema)` returns a `Runnable` whose
   * `.invoke()` does the schema hinting (function-calling under the hood) + parse + Zod-validate
   * in one call.
   *
   * LangChain's own validation is a *hint*, not a guarantee this method relies on -- the returned
   * value is always re-parsed and re-validated against the caller's own `schema` here regardless,
   * exactly as this method's interface doc comment requires ("never trusts LangChain's schema
   * hinting alone"). Never retries internally; a caller wanting a corrected retry (e.g. this
   * story's citation-verification retry policy) calls this method again with a fresh prompt.
   */
  async generateStructuredOutput<T>(params: {
    systemInstruction: string;
    prompt: string;
    schema: ZodType<T>;
  }): Promise<T> {
    const structuredModel = this.chatModel.withStructuredOutput(params.schema);
    let raw: unknown;
    try {
      raw = await structuredModel.invoke([
        ['system', params.systemInstruction],
        ['human', params.prompt],
      ]);
    } catch (err) {
      // The call itself failed (network error, rate limit, 5xx/"high demand", or a 4xx like an
      // invalid API key) -- the provider never actually produced a response for us to reject,
      // which is a materially different failure than the schema-validation throw below (a
      // response we didn't like). Wrapped in ProviderUnavailableError, classified by kind, so
      // callers can tell a daily quota apart from a transient overload and message users
      // honestly instead of one generic bucket (2026-09-03).
      const message = err instanceof Error ? err.message : String(err);
      const { kind, retryAfterSeconds } = classifyFetchError(err);
      throw new ProviderUnavailableError(message, kind, err, retryAfterSeconds);
    }

    // Zod's own SafeParseReturnType (a discriminated union on `success`), narrowed on its own
    // native type -- deliberately not routed through a bespoke wrapper type of this module's own,
    // since apps/api's own (deliberately non-strict) tsconfig type-checks this file too when it's
    // imported transitively, and TypeScript only narrows a *plain* discriminated union like that
    // reliably under `strictNullChecks` (this lib's own tsconfig opts into `strict: true`, but a
    // consuming app's looser config does not).
    const result = params.schema.safeParse(raw);
    if (!result.success) {
      const errorMessage = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(
        `Gemini's structured-output response failed schema validation: ${errorMessage}`,
      );
    }
    return result.data;
  }
}
