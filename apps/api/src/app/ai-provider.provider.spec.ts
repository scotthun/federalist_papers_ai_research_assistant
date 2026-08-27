import type { AIProvider } from '@federalist-research/ai';

/**
 * Fakes `createAIProvider` entirely (its own fail-fast/config-selection behavior is already
 * covered by `libs/ai`'s `ai-provider.factory.spec.ts`) so this spec covers only what
 * `createAIProviderProvider` itself adds: deferring the real construction call until the first
 * `generateEmbedding`/`generateStructuredOutput` invocation, and memoizing the result afterward
 * (shared across both methods) -- the behavior that lets a missing/invalid AI config break only
 * the specific route/tier that needed it, never the whole apps/api server at boot (see the
 * provider's own doc comment for the full reasoning). Moved here from `app/papers/` in Story 3.1
 * once `AskModule` needed the exact same lazy wrapper as `PapersModule`.
 */
jest.mock('@federalist-research/ai', () => ({
  createAIProvider: jest.fn(),
}));

import { createAIProvider } from '@federalist-research/ai';
import { AI_PROVIDER, createAIProviderProvider } from './ai-provider.provider';

const mockedCreateAIProvider = createAIProvider as jest.Mock;

describe('createAIProviderProvider', () => {
  beforeEach(() => {
    mockedCreateAIProvider.mockReset();
  });

  function buildLazyProvider(): AIProvider {
    const provider = createAIProviderProvider() as {
      provide: string;
      useFactory: () => AIProvider;
    };
    expect(provider.provide).toBe(AI_PROVIDER);
    return provider.useFactory();
  }

  it('never calls createAIProvider at factory-construction time', () => {
    mockedCreateAIProvider.mockImplementation(() => {
      throw new Error('GEMINI_API_KEY is not set');
    });

    expect(() => buildLazyProvider()).not.toThrow();
    expect(mockedCreateAIProvider).not.toHaveBeenCalled();
  });

  it('rejects generateEmbedding with the same error createAIProvider throws', async () => {
    mockedCreateAIProvider.mockImplementation(() => {
      throw new Error('GEMINI_API_KEY is not set');
    });
    const aiProvider = buildLazyProvider();

    await expect(aiProvider.generateEmbedding('a query')).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
  });

  it('retries construction on the next call rather than caching a failed attempt as success', async () => {
    mockedCreateAIProvider.mockImplementation(() => {
      throw new Error('still broken');
    });
    const aiProvider = buildLazyProvider();

    await expect(aiProvider.generateEmbedding('first')).rejects.toThrow('still broken');
    await expect(aiProvider.generateEmbedding('second')).rejects.toThrow('still broken');
    expect(mockedCreateAIProvider).toHaveBeenCalledTimes(2);
  });

  it('constructs the real provider lazily and memoizes it across multiple generateEmbedding calls', async () => {
    const fakeConcreteProvider = {
      generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      generateStructuredOutput: jest.fn(),
    };
    mockedCreateAIProvider.mockReturnValue(fakeConcreteProvider);
    const aiProvider = buildLazyProvider();

    await aiProvider.generateEmbedding('first');
    await aiProvider.generateEmbedding('second');

    expect(mockedCreateAIProvider).toHaveBeenCalledTimes(1);
    expect(fakeConcreteProvider.generateEmbedding).toHaveBeenNthCalledWith(1, 'first');
    expect(fakeConcreteProvider.generateEmbedding).toHaveBeenNthCalledWith(2, 'second');
  });

  it('rejects generateStructuredOutput with the same error createAIProvider throws', async () => {
    mockedCreateAIProvider.mockImplementation(() => {
      throw new Error('GEMINI_API_KEY is not set');
    });
    const aiProvider = buildLazyProvider();

    await expect(
      aiProvider.generateStructuredOutput({
        systemInstruction: 'sys',
        prompt: 'prompt',
        schema: { safeParse: jest.fn() } as never,
      }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it('shares the same memoized construction between generateEmbedding and generateStructuredOutput', async () => {
    const fakeConcreteProvider = {
      generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
      generateStructuredOutput: jest.fn().mockResolvedValue({ answer: 'ok', citations: [] }),
    };
    mockedCreateAIProvider.mockReturnValue(fakeConcreteProvider);
    const aiProvider = buildLazyProvider();

    await aiProvider.generateEmbedding('first');
    await aiProvider.generateStructuredOutput({
      systemInstruction: 'sys',
      prompt: 'prompt',
      schema: { safeParse: jest.fn() } as never,
    });

    // Only one construction across both methods -- whichever is called first constructs and
    // caches it for the other.
    expect(mockedCreateAIProvider).toHaveBeenCalledTimes(1);
    expect(fakeConcreteProvider.generateStructuredOutput).toHaveBeenCalledTimes(1);
  });
});
