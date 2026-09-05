import type { Provider } from '@nestjs/common';
import {
  createEmbeddingProvider,
  createGenerationProvider,
  type EmbeddingProvider,
  type GenerationProvider,
} from '@federalist-research/ai';

/** DI token for the `EmbeddingProvider` injected into a module's graph -- the always-Gemini half
 *  of the seam (spec-openrouter-provider.md's Spec Change Log split `AI_PROVIDER`'s one combined
 *  token in two once `AskModule` needed a generation provider that could be OpenRouter while its
 *  embedding calls, via `retrieveRelevantChunks`, still always need Gemini). Injected by
 *  `PapersModule` (Story 2.2) and `AskModule` (Story 3.1). */
export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER';

/** DI token for the `GenerationProvider` injected into a module's graph -- the `AI_PROVIDER`-driven
 *  half of the seam (`createGenerationProvider`, "gemini" or "openrouter"). Injected only by
 *  `AskModule` (Story 3.1) -- `PapersModule`'s routes never call `generateStructuredOutput`. */
export const GENERATION_PROVIDER = 'GENERATION_PROVIDER';

/**
 * Builds the `EMBEDDING_PROVIDER` factory provider shared by `PapersModule` (`generateEmbedding`,
 * Story 2.2) and `AskModule` (Story 3.1).
 *
 * `createEmbeddingProvider()` itself fails fast -- it throws synchronously when `GEMINI_API_KEY`
 * is missing. That's exactly right for `ingest.ts`'s standalone, AI-is-essential-to-the-whole-run
 * script (main() constructs it once, before the loop, precisely so a bad config aborts immediately
 * instead of failing 85 times). It would be the wrong behavior here: both `PapersModule` and
 * `AskModule` also serve routes that don't need an embedding call at all (or, for `AskModule`'s
 * clarify/refuse tiers, don't call it because tier decisions happen after retrieval) -- a missing
 * `GEMINI_API_KEY` must never prevent the whole apps/api server from booting just because one
 * route/tier needs it.
 *
 * The returned provider is therefore a thin, lazily-initializing `EmbeddingProvider` wrapper: the
 * real `createEmbeddingProvider()` call (and therefore its throw) is deferred until the first
 * actual `generateEmbedding` call, memoizing the constructed provider afterward. This turns
 * "missing API key" into a per-request error on the routes/tiers that actually need it, never a
 * boot-time failure.
 */
export function createEmbeddingProviderProvider(): Provider {
  return {
    provide: EMBEDDING_PROVIDER,
    useFactory: (): EmbeddingProvider => {
      let cached: EmbeddingProvider | undefined;
      function getOrConstruct(): EmbeddingProvider {
        if (!cached) {
          cached = createEmbeddingProvider();
        }
        return cached;
      }
      return {
        // Declared `async` deliberately, not just "returns a Promise": every real
        // EmbeddingProvider implementation (e.g. GeminiProvider) only ever rejects, never throws
        // synchronously. `createEmbeddingProvider()` itself *does* throw synchronously on a bad
        // config -- without `async` here, that throw would escape this call synchronously on its
        // first invocation instead of becoming a rejected promise, breaking that implicit
        // interface contract for callers that (correctly) assume these methods never throw
        // synchronously.
        generateEmbedding: async (text: string) => {
          return getOrConstruct().generateEmbedding(text);
        },
      };
    },
  };
}

/**
 * Builds the `GENERATION_PROVIDER` factory provider for `AskModule` (Story 3.1's confident tier).
 * Same lazy-construction rationale as `createEmbeddingProviderProvider` above -- a missing/invalid
 * `AI_PROVIDER`/`OPENROUTER_API_KEY`/`GEMINI_API_KEY` config must never prevent apps/api from
 * booting just because the confident tier (which may not even run for a given request) needs it.
 */
export function createGenerationProviderProvider(): Provider {
  return {
    provide: GENERATION_PROVIDER,
    useFactory: (): GenerationProvider => {
      let cached: GenerationProvider | undefined;
      function getOrConstruct(): GenerationProvider {
        if (!cached) {
          cached = createGenerationProvider();
        }
        return cached;
      }
      return {
        generateStructuredOutput: async (params) => {
          return getOrConstruct().generateStructuredOutput(params);
        },
      };
    },
  };
}
