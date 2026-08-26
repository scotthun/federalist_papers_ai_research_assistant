import type { Provider } from '@nestjs/common';
import { createAIProvider, type AIProvider } from '@federalist-research/ai';

/** DI token for the `AIProvider` injected into `PapersModule`'s graph -- the first time
 *  `libs/ai`'s `createAIProvider()` factory is wired into NestJS's container rather than called
 *  directly as a plain function (`apps/api/src/ingest.ts`'s standalone-script usage). */
export const AI_PROVIDER = 'AI_PROVIDER';

/**
 * Builds the `AI_PROVIDER` factory provider for `PapersModule`.
 *
 * `createAIProvider()` itself fails fast -- it throws synchronously when `AI_PROVIDER`/
 * `GEMINI_API_KEY` is missing or invalid. That's exactly right for `ingest.ts`'s standalone,
 * AI-is-essential-to-the-whole-run script (main() constructs it once, before the loop, precisely
 * so a bad config aborts immediately instead of failing 85 times). It would be the wrong
 * behavior here: `PapersModule` also serves `GET /api/papers`, `/search`, and `/:paperNumber`,
 * none of which need an AI provider at all -- a missing `GEMINI_API_KEY` must never prevent the
 * whole apps/api server from booting just because one unrelated route needs it.
 *
 * The returned provider is therefore a thin, lazily-initializing `AIProvider` wrapper: the real
 * `createAIProvider()` call (and therefore its throw) is deferred until the first actual
 * `generateEmbedding` call, memoizing the constructed provider afterward. This turns "missing API
 * key" into a per-request error on `GET /api/papers/search/semantic` only (this story's I/O
 * Edge-Case Matrix, "Embedding call fails" row) -- every other endpoint keeps working normally
 * regardless of AI configuration.
 */
export function createAIProviderProvider(): Provider {
  return {
    provide: AI_PROVIDER,
    useFactory: (): AIProvider => {
      let cached: AIProvider | undefined;
      return {
        // Declared `async` deliberately, not just "returns a Promise": every real AIProvider
        // implementation (e.g. GeminiProvider) only ever rejects, never throws synchronously.
        // `createAIProvider()` itself *does* throw synchronously on a bad config -- without
        // `async` here, that throw would escape this call synchronously on its first invocation
        // instead of becoming a rejected promise, breaking that implicit interface contract for
        // callers that (correctly) assume `generateEmbedding` never throws synchronously.
        generateEmbedding: async (text: string) => {
          if (!cached) {
            cached = createAIProvider();
          }
          return cached.generateEmbedding(text);
        },
      };
    },
  };
}
