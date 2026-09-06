import { ChatGroq } from '@langchain/groq';
import type { ZodType } from 'zod';
import {
  ProviderUnavailableError,
  type GenerationProvider,
  type ProviderFailureKind,
} from '../ai-provider.interface';

/** Loose shape of `groq-sdk`'s `APIError` (and subclasses like `RateLimitError`,
 *  `InternalServerError`) that `@langchain/groq` throws/re-throws verbatim on a failed call
 *  (confirmed by reading `groq-sdk`'s own `core/error.ts`: `APIError.generate` builds one of these
 *  subclasses straight from the HTTP response's status/body/headers, and `@langchain/groq` never
 *  catches/rewraps it) -- byte-for-byte the same `.status`/`.error`/`.headers` shape as the `openai`
 *  SDK's `APIError` that `classifyOpenRouterError` targets (this story's Boundaries: "confirm the
 *  exact shape live during implementation rather than assuming byte-for-byte parity" -- confirmed
 *  by reading both SDKs' source during this story's implementation: Groq's API is itself
 *  OpenAI-API-shaped, and `groq-sdk` is generated the same way `openai`'s SDK is). Declared locally
 *  instead of depending on `groq-sdk` directly -- that package is `@langchain/groq`'s own
 *  transitive dependency, never a direct one of this lib's, and this shape is all
 *  `classifyGroqError` below actually needs from it. */
interface GroqAPIErrorShape {
  status?: number;
  /** JSON body of the response that caused the error -- Groq's shape is
   *  `{ message, type, code }`, a plain object nested one level under the SDK's own `.error` (see
   *  `groq-sdk`'s `APIError.generate`, which reads `errorResponse.error` before constructing the
   *  typed subclass). */
  error?: { message?: string; code?: string | number; [key: string]: unknown };
  /** The HTTP response's own headers, when the SDK had a response to read them from at all (a
   *  plain network failure/timeout never gets this far -- `APIError.generate` falls back to an
   *  `APIConnectionError`, which has neither `status` nor `headers`). Used to read a standard
   *  `Retry-After` header, when Groq supplies one. */
  headers?: { get(name: string): string | null };
}

function isGroqAPIErrorShape(err: unknown): err is GroqAPIErrorShape {
  return typeof err === 'object' && err !== null && 'status' in err;
}

/** Parses a standard HTTP `Retry-After` header (always whole seconds per RFC 9110), identical to
 *  `openrouter.provider.ts`'s `parseRetryAfterSeconds`. `undefined` when absent/unparseable/
 *  non-positive. */
function parseRetryAfterSeconds(headers: GroqAPIErrorShape['headers']): number | undefined {
  const raw = headers?.get('retry-after');
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** `true` when a 429's error body indicates a *daily* free-tier cap (1,000 requests/day for
 *  `openai/gpt-oss-120b`, per this story's Design Notes) rather than the shorter per-minute/
 *  per-token-window one (30 requests/minute). Groq's 429 body has no structured quota-kind field
 *  analogous to Gemini's `QuotaFailure.violations[].quotaId`, mirroring `isDailyQuotaMessage` in
 *  `openrouter.provider.ts` -- matches the wording Groq's own docs and error messages use for the
 *  daily cap ("daily limit"/"requests per day") vs the per-minute cap's "requests per minute".
 *  Deliberately permissive for the same reason as its OpenRouter sibling: misclassifying a daily
 *  exhaustion as the short-window case would tell a user "wait a few seconds" when retrying is
 *  pointless until tomorrow. */
function isDailyQuotaMessage(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  return /\bday\b|\bdaily\b|per[- ]day/i.test(message);
}

/** `true` when the error body's message indicates the request (question + evidence + conversation
 *  history) exceeded the model's context window -- Groq's OpenAI-compatible shape has no dedicated
 *  status/field for this any more than OpenRouter's or Gemini's does (spec-conversation-history-
 *  context.md), so this is message-content matching, identical to `openrouter.provider.ts`'s
 *  `isContextLengthExceededMessage` and `gemini.provider.ts`'s own helper of the same name. */
function isContextLengthExceededMessage(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  return /context length|context window|token limit|maximum.*tokens|context_length_exceeded/i.test(
    message,
  );
}

/** Classifies a caught error into a `ProviderFailureKind` + optional retry hint, from whatever
 *  HTTP status/error-body metadata is available -- `err` may not even be a real HTTP error at all
 *  (a plain network failure/timeout has no `.status`), so every field here is read defensively
 *  rather than assumed present. Identical in shape and intent to `openrouter.provider.ts`'s
 *  `classifyOpenRouterError`, keyed off the same `.status`/`.error`/`.headers` shape (this story's
 *  Boundaries: Groq's error shape closely resembles OpenRouter's since `@langchain/groq` is itself
 *  OpenAI-API-shaped under the hood -- confirmed live against `groq-sdk`'s own source during this
 *  story's implementation). Reuses the existing `ProviderFailureKind` set rather than inventing
 *  Groq-specific kinds (this story's Boundaries/Never). */
function classifyGroqError(err: unknown): {
  kind: ProviderFailureKind;
  retryAfterSeconds?: number;
} {
  if (!isGroqAPIErrorShape(err) || err.status === undefined) {
    return { kind: 'unavailable' };
  }
  const { status, error, headers } = err;
  if (status === 429) {
    return {
      kind: isDailyQuotaMessage(error?.message) ? 'rate_limited_daily' : 'rate_limited_short',
      retryAfterSeconds: parseRetryAfterSeconds(headers),
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
  if (isContextLengthExceededMessage(error?.message)) {
    return { kind: 'context_length_exceeded' };
  }
  // Any other 4xx (400 malformed request, 401/403 auth/permission) -- a configuration/
  // programming problem, not something transient (mirrors gemini.provider.ts's and
  // openrouter.provider.ts's identical reasoning).
  return { kind: 'client_error' };
}

// The only free-tier model confirmed, against Groq's own structured-outputs doc (this story's
// Design Notes, researched 2026-09-06), to support *strict* JSON-schema-conformant structured
// output -- `llama-3.3-70b-versatile` and other Llama models are not listed for this feature (an
// earlier, apparently-stale recollection to the contrary was corrected by this story's live doc
// check). Free-tier limits confirmed directly from Groq's rate-limits doc: 30 requests/minute,
// 1,000 requests/day, 8,000 tokens/minute, 200,000 tokens/day -- both far more usable as a live-
// demo fallback than OpenRouter's free Nemotron tier. Overridable via
// GroqProviderOptions.model/GROQ_MODEL (this story's Boundaries: "must be overridable ... since
// Groq's free-tier model roster and rate limits can change") -- never hardcode this as anything
// other than a default.
const DEFAULT_GENERATION_MODEL = 'openai/gpt-oss-120b';

export interface GroqProviderOptions {
  apiKey: string;
  /** Overrides `DEFAULT_GENERATION_MODEL`. See `GROQ_MODEL` in `.env.example`. */
  model?: string;
}

/**
 * Concrete Adapter wrapping Groq's chat-completions API behind the `GenerationProvider` interface,
 * via `@langchain/groq`'s dedicated `ChatGroq` integration (this story's Approach -- unlike the
 * OpenRouter story, no generic `ChatOpenAI` + `baseURL` override trick is needed here; Groq has its
 * own first-class, actively-maintained LangChain package).
 *
 * Deliberately does *not* implement `EmbeddingProvider` -- embeddings stay Gemini-only
 * (`ai-provider.interface.ts`'s doc comment), mirroring `OpenRouterProvider`'s exact reasoning; this
 * class is a complete, honest implementation of the one interface it actually claims, not a
 * `generateEmbedding` stub that throws.
 */
export class GroqProvider implements GenerationProvider {
  private readonly chatModel: ChatGroq;

  constructor(options: GroqProviderOptions) {
    if (!options.apiKey) {
      throw new Error('GroqProvider requires a non-empty apiKey');
    }
    // maxRetries: 0 -- @langchain/core's AsyncCaller otherwise defaults to 6 silent internal
    // retries on transient errors, which would violate this method's "never retries internally --
    // one model call per invocation" contract at runtime, exactly like GeminiProvider's and
    // OpenRouterProvider's identical setting.
    this.chatModel = new ChatGroq({
      model: options.model ?? DEFAULT_GENERATION_MODEL,
      apiKey: options.apiKey,
      maxRetries: 0,
    });
  }

  /**
   * Implements `GenerationProvider.generateStructuredOutput` via LangChain's standard
   * structured-output pattern, identically to `GeminiProvider`'s and `OpenRouterProvider`'s own
   * implementations: `ChatGroq.withStructuredOutput(schema)` returns a `Runnable` whose `.invoke()`
   * does the schema hinting + parse + Zod-validate in one call, and the returned value is always
   * re-parsed and re-validated against the caller's own `schema` here regardless -- LangChain's own
   * validation (and Groq's own strict-mode guarantee) is a hint, never a guarantee this method
   * relies on. Never retries internally; a caller wanting a corrected retry calls this method again
   * with a fresh prompt.
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
      // The call itself failed (network error, rate limit, 5xx/overload, or a 4xx like an invalid
      // API key) -- the provider never actually produced a response for us to reject, which is a
      // materially different failure than the schema-validation throw below (a response we didn't
      // like). Wrapped in ProviderUnavailableError, classified by kind, exactly like
      // GeminiProvider's and OpenRouterProvider's identical catch.
      const message = err instanceof Error ? err.message : String(err);
      const { kind, retryAfterSeconds } = classifyGroqError(err);
      throw new ProviderUnavailableError(message, kind, err, retryAfterSeconds);
    }

    // Zod's own SafeParseReturnType, narrowed on its own native type -- same rationale as
    // GeminiProvider's and OpenRouterProvider's identical comment: apps/api's own (deliberately
    // non-strict) tsconfig type-checks this file too when it's imported transitively, and
    // TypeScript only narrows a plain discriminated union like this reliably under
    // `strictNullChecks`.
    const result = params.schema.safeParse(raw);
    if (!result.success) {
      const errorMessage = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(
        `Groq's structured-output response failed schema validation: ${errorMessage}`,
      );
    }
    return result.data;
  }
}
