import type { EmbeddingProvider, GenerationProvider } from './ai-provider.interface';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';

/**
 * Factory (stack.md's "AI provider abstraction") for the embedding half of the seam. Always
 * constructs a `GeminiProvider`, regardless of `AI_PROVIDER` -- embeddings stay Gemini-only
 * (`ai-provider.interface.ts`'s doc comment: pgvector's stored `document_chunks.embedding` column
 * is pinned to `gemini-embedding-001`'s 3072-dimension output, a deliberate, separately-costed
 * migration to change). `GEMINI_API_KEY` is therefore required unconditionally, independent of
 * whichever `AI_PROVIDER` `createGenerationProvider` selects (spec-openrouter-provider.md's Spec
 * Change Log).
 */
export function createEmbeddingProvider(
  env: Record<string, string | undefined> = process.env,
): EmbeddingProvider {
  const apiKey = env['GEMINI_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Embeddings always use Gemini regardless of AI_PROVIDER -- set GEMINI_API_KEY in the environment (see .env.example).',
    );
  }
  const generationModel = env['GEMINI_GENERATION_MODEL'];
  return new GeminiProvider({ apiKey, generationModel });
}

/**
 * Factory (stack.md's "AI provider abstraction"): the single seam that reads `AI_PROVIDER` and
 * constructs the matching concrete generation adapter. Every call site outside `libs/ai` depends
 * only on `GenerationProvider`/`createGenerationProvider` -- never a vendor SDK directly. Adding a
 * third generation provider later is one new adapter class plus one new `case` here, nothing else.
 *
 * Generation-only (was `createAIProvider`, covering embeddings too, before
 * spec-openrouter-provider.md's Spec Change Log split the seam in two once `OpenRouterProvider`
 * needed to implement generation without embeddings) -- see `createEmbeddingProvider` for the
 * always-Gemini embedding half.
 *
 * Fails fast with a clear error (matching apps/api's `env.validation.ts` pattern) rather than
 * booting against a missing/unsupported provider config.
 */
export function createGenerationProvider(
  env: Record<string, string | undefined> = process.env,
): GenerationProvider {
  const provider = env['AI_PROVIDER'] ?? 'gemini';

  switch (provider) {
    case 'gemini': {
      const apiKey = env['GEMINI_API_KEY'];
      if (!apiKey) {
        throw new Error(
          'AI_PROVIDER is "gemini" but GEMINI_API_KEY is not set. Set GEMINI_API_KEY in the environment (see .env.example).',
        );
      }
      // Optional -- GeminiProvider falls back to its own default when unset (see
      // GEMINI_GENERATION_MODEL in .env.example). Lets a specific model's live 503s be worked
      // around by restarting with a different env value, not by editing source.
      const generationModel = env['GEMINI_GENERATION_MODEL'];
      return new GeminiProvider({ apiKey, generationModel });
    }
    case 'openrouter': {
      const apiKey = env['OPENROUTER_API_KEY'];
      if (!apiKey) {
        throw new Error(
          'AI_PROVIDER is "openrouter" but OPENROUTER_API_KEY is not set. Set OPENROUTER_API_KEY in the environment (see .env.example).',
        );
      }
      // Optional -- OpenRouterProvider falls back to its own default free Nemotron model when
      // unset (see OPENROUTER_MODEL in .env.example). Lets OpenRouter's free-model catalog
      // changing, or a specific model's live unavailability, be worked around by restarting with a
      // different env value, not by editing source.
      const model = env['OPENROUTER_MODEL'];
      return new OpenRouterProvider({ apiKey, model });
    }
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${provider}". Supported providers: gemini, openrouter.`,
      );
  }
}
