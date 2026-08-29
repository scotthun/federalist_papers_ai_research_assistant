import type { Provider } from '@nestjs/common';
import { createAIProvider, type AIProvider } from '@federalist-research/ai';

/** DI token for the `AIProvider` injected into a module's graph -- the first time `libs/ai`'s
 *  `createAIProvider()` factory is wired into NestJS's container rather than called directly as a
 *  plain function (`apps/api/src/ingest.ts`'s standalone-script usage). Originally added for
 *  `PapersModule` (Story 2.2); moved out of `app/papers/` and shared with `AskModule` (Story 3.1)
 *  once a second module needed the exact same lazy-construction behavior for the same reason. */
export const AI_PROVIDER = 'AI_PROVIDER';

/**
 * Builds the `AI_PROVIDER` factory provider shared by `PapersModule` (`generateEmbedding`, Story
 * 2.2) and `AskModule` (`generateEmbedding` + `generateStructuredOutput`, Story 3.1).
 *
 * `createAIProvider()` itself fails fast -- it throws synchronously when `AI_PROVIDER`/
 * `GEMINI_API_KEY` is missing or invalid. That's exactly right for `ingest.ts`'s standalone,
 * AI-is-essential-to-the-whole-run script (main() constructs it once, before the loop, precisely
 * so a bad config aborts immediately instead of failing 85 times). It would be the wrong
 * behavior here: both `PapersModule` and `AskModule` also serve routes that don't need an AI
 * provider at all (or, for `AskModule`'s clarify/refuse tiers, don't call the LLM even though the
 * module has one wired in) -- a missing `GEMINI_API_KEY` must never prevent the whole apps/api
 * server from booting just because one route/tier needs it.
 *
 * The returned provider is therefore a thin, lazily-initializing `AIProvider` wrapper: the real
 * `createAIProvider()` call (and therefore its throw) is deferred until the first actual
 * `generateEmbedding`/`generateStructuredOutput` call, memoizing the constructed provider
 * afterward (shared between both methods -- whichever is called first constructs and caches it
 * for the other). This turns "missing API key" into a per-request error on the routes/tiers that
 * actually need it, never a boot-time failure.
 */
export function createAIProviderProvider(): Provider {
  return {
    provide: AI_PROVIDER,
    useFactory: (): AIProvider => {
      let cached: AIProvider | undefined;
      function getOrConstruct(): AIProvider {
        if (!cached) {
          cached = createAIProvider();
        }
        return cached;
      }
      return {
        // Declared `async` deliberately, not just "returns a Promise": every real AIProvider
        // implementation (e.g. GeminiProvider) only ever rejects, never throws synchronously.
        // `createAIProvider()` itself *does* throw synchronously on a bad config -- without
        // `async` here, that throw would escape this call synchronously on its first invocation
        // instead of becoming a rejected promise, breaking that implicit interface contract for
        // callers that (correctly) assume these methods never throw synchronously.
        generateEmbedding: async (text: string) => {
          return getOrConstruct().generateEmbedding(text);
        },
        generateStructuredOutput: async (params) => {
          return getOrConstruct().generateStructuredOutput(params);
        },
      };
    },
  };
}
