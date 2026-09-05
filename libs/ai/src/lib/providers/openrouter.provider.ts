import { ChatOpenAI } from '@langchain/openai';
import type { ZodType } from 'zod';
import {
  ProviderUnavailableError,
  type GenerationProvider,
  type ProviderFailureKind,
} from '../ai-provider.interface';

/** Loose shape of the `openai` SDK's `APIError` (and subclasses like `RateLimitError`,
 *  `InternalServerError`) that `@langchain/openai` throws/re-throws verbatim on a failed call
 *  (confirmed by reading `openai`'s own `core/error.ts`: `APIError.generate` builds one of these
 *  subclasses straight from the HTTP response's status/body/headers, and `@langchain/openai`
 *  never catches/rewraps it). Declared locally instead of depending on `openai` directly -- that
 *  package is `@langchain/openai`'s own transitive dependency, never a direct one of this lib's,
 *  and this shape is all `classifyOpenRouterError` below actually needs from it. */
interface OpenAIAPIErrorShape {
  status?: number;
  /** JSON body of the response that caused the error -- OpenRouter's shape is
   *  `{ message, code, metadata? }`, a plain object nested one level under the SDK's own `.error`
   *  (see `openai`'s `APIError.generate`, which reads `errorResponse.error` before constructing
   *  the typed subclass). */
  error?: { message?: string; code?: string | number; [key: string]: unknown };
  /** The HTTP response's own headers, when the SDK had a response to read them from at all (a
   *  plain network failure/timeout never gets this far -- `APIError.generate` falls back to an
   *  `APIConnectionError`, which has neither `status` nor `headers`). Used to read a standard
   *  `Retry-After` header, when OpenRouter supplies one. */
  headers?: { get(name: string): string | null };
}

function isOpenAIAPIErrorShape(err: unknown): err is OpenAIAPIErrorShape {
  return typeof err === 'object' && err !== null && 'status' in err;
}

/** Parses a standard HTTP `Retry-After` header (always whole seconds per RFC 9110 -- unlike
 *  Gemini's `RetryInfo` detail, OpenRouter/the generic OpenAI-compatible API shape has no
 *  fractional-seconds string to round up). `undefined` when absent/unparseable/non-positive. */
function parseRetryAfterSeconds(headers: OpenAIAPIErrorShape['headers']): number | undefined {
  const raw = headers?.get('retry-after');
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const seconds = Number.parseInt(raw, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** `true` when a 429's error body indicates a *daily* free-tier cap rather than the flat
 *  20-requests/minute one (this story's Boundaries: "the `rate_limited_daily` vs
 *  `rate_limited_short` classification must reflect" that OpenRouter's free-tier limits are
 *  account-level, not per-model). OpenRouter's 429 body has no structured quota-kind field
 *  analogous to Gemini's `QuotaFailure.violations[].quotaId` (this story's Design Notes: "verify
 *  the actual shape live during implementation rather than assuming parity" -- live verification
 *  wasn't available in this environment, so this falls back to matching the wording OpenRouter's
 *  own docs and error messages use for the daily cap, e.g. "daily limit"/"requests per day" vs the
 *  per-minute cap's "requests per minute"). Deliberately permissive (matches "day" anywhere in the
 *  message) so a reworded-but-still-daily message doesn't silently misclassify as the short-window
 *  case, which would tell a user "wait a few seconds" when retrying is actually pointless until
 *  tomorrow. */
function isDailyQuotaMessage(message: string | undefined): boolean {
  if (!message) {
    return false;
  }
  return /\bday\b|\bdaily\b|per[- ]day/i.test(message);
}

/** Classifies a caught error into a `ProviderFailureKind` + optional retry hint, from whatever
 *  HTTP status/error-body metadata is available -- `err` may not even be a real HTTP error at all
 *  (a plain network failure/timeout has no `.status`), so every field here is read defensively
 *  rather than assumed present. Mirrors `gemini.provider.ts`'s `classifyFetchError` in shape and
 *  intent, keyed off the OpenAI-SDK error shape (`.status`/`.error`/`.headers`) instead of
 *  `@google/generative-ai`'s `GoogleGenerativeAIFetchError` shape (this story's Boundaries). */
function classifyOpenRouterError(err: unknown): {
  kind: ProviderFailureKind;
  retryAfterSeconds?: number;
} {
  if (!isOpenAIAPIErrorShape(err) || err.status === undefined) {
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
  // Any other 4xx (400 malformed request, 401/403 auth/permission) -- a configuration/
  // programming problem, not something transient (mirrors gemini.provider.ts's identical
  // reasoning for its own `classifyFetchError`).
  return { kind: 'client_error' };
}

// OpenRouter's only free Nemotron model (as of this story's 2026-09-05 research, queried live
// against `GET https://openrouter.ai/api/v1/models`) exposing both `response_format`/
// `structured_outputs` and `tools`/`tool_choice` in its `supported_parameters` -- the other free
// Nemotron variants (`nemotron-3.5-lightning`, `nemotron-3.5-content-safety`,
// `nemotron-3-ultra-550b-a55b`, `nemotron-3-nano-omni-30b-a3b-reasoning`) support tool-calling
// only (or, for `nemotron-3.5-content-safety`, no tool support at all), meaning
// `.withStructuredOutput()` would fall back to LangChain's tool-calling strategy rather than
// native JSON mode -- functional, but less deterministic for schema adherence (this story's Design
// Notes). Overridable via OpenRouterProviderOptions.model/OPENROUTER_MODEL (this story's
// Boundaries: "must be overridable ... since OpenRouter's free-model catalog and rate-limit tiers
// can change") -- never hardcode this as anything other than a default.
const DEFAULT_GENERATION_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterProviderOptions {
  apiKey: string;
  /** Overrides `DEFAULT_GENERATION_MODEL`. See `OPENROUTER_MODEL` in `.env.example`. */
  model?: string;
}

/**
 * Concrete Adapter wrapping OpenRouter's OpenAI-compatible chat-completions API behind the
 * `GenerationProvider` interface, via `@langchain/openai`'s `ChatOpenAI` with `configuration.
 * baseURL` overridden to OpenRouter's endpoint (this story's Approach -- the longer-established,
 * better-documented path versus the newer dedicated `@langchain/openrouter` package/`ChatOpenRouter`
 * class; see this story's Spec Change Log for why the latter wasn't chosen despite being
 * peer-compatible with this repo's pinned `@langchain/core@1.2.9`).
 *
 * Deliberately does *not* implement `EmbeddingProvider` -- embeddings stay Gemini-only
 * (`ai-provider.interface.ts`'s doc comment); this class is a complete, honest implementation of
 * the one interface it actually claims, not a `generateEmbedding` stub that throws.
 */
export class OpenRouterProvider implements GenerationProvider {
  private readonly chatModel: ChatOpenAI;

  constructor(options: OpenRouterProviderOptions) {
    if (!options.apiKey) {
      throw new Error('OpenRouterProvider requires a non-empty apiKey');
    }
    // maxRetries: 0 -- @langchain/core's AsyncCaller otherwise defaults to 6 silent internal
    // retries on transient errors, which would violate this method's "never retries internally --
    // one model call per invocation" contract at runtime, exactly like GeminiProvider's identical
    // setting.
    this.chatModel = new ChatOpenAI({
      model: options.model ?? DEFAULT_GENERATION_MODEL,
      apiKey: options.apiKey,
      configuration: { baseURL: OPENROUTER_BASE_URL },
      maxRetries: 0,
    });
  }

  /**
   * Implements `GenerationProvider.generateStructuredOutput` via LangChain's standard
   * structured-output pattern, identically to `GeminiProvider`'s own implementation:
   * `ChatOpenAI.withStructuredOutput(schema)` returns a `Runnable` whose `.invoke()` does the
   * schema hinting + parse + Zod-validate in one call, and the returned value is always re-parsed
   * and re-validated against the caller's own `schema` here regardless -- LangChain's own
   * validation is a hint, never a guarantee this method relies on. Never retries internally; a
   * caller wanting a corrected retry calls this method again with a fresh prompt.
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
      // GeminiProvider's identical catch.
      const message = err instanceof Error ? err.message : String(err);
      const { kind, retryAfterSeconds } = classifyOpenRouterError(err);
      throw new ProviderUnavailableError(message, kind, err, retryAfterSeconds);
    }

    // Zod's own SafeParseReturnType, narrowed on its own native type -- same rationale as
    // GeminiProvider's identical comment: apps/api's own (deliberately non-strict) tsconfig
    // type-checks this file too when it's imported transitively, and TypeScript only narrows a
    // plain discriminated union like this reliably under `strictNullChecks`.
    const result = params.schema.safeParse(raw);
    if (!result.success) {
      const errorMessage = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(
        `OpenRouter's structured-output response failed schema validation: ${errorMessage}`,
      );
    }
    return result.data;
  }
}
