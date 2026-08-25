import type { AIProvider } from './ai-provider.interface';
import { GeminiProvider } from './providers/gemini.provider';

/**
 * Factory (stack.md's "AI provider abstraction"): the single seam that reads `AI_PROVIDER` and
 * constructs the matching concrete adapter. Every call site outside `libs/ai` depends only on
 * `AIProvider`/`createAIProvider` -- never a vendor SDK directly. Adding a second provider later
 * is one new adapter class plus one new `case` here, nothing else.
 *
 * Fails fast with a clear error (matching apps/api's `env.validation.ts` pattern) rather than
 * booting against a missing/unsupported provider config.
 */
export function createAIProvider(
  env: Record<string, string | undefined> = process.env,
): AIProvider {
  const provider = env['AI_PROVIDER'] ?? 'gemini';

  switch (provider) {
    case 'gemini': {
      const apiKey = env['GEMINI_API_KEY'];
      if (!apiKey) {
        throw new Error(
          'AI_PROVIDER is "gemini" but GEMINI_API_KEY is not set. Set GEMINI_API_KEY in the environment (see .env.example).',
        );
      }
      return new GeminiProvider({ apiKey });
    }
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${provider}". Supported providers: gemini.`,
      );
  }
}
