import type { AIProvider } from '@federalist-research/ai';

/**
 * Fakes `createAIProvider` entirely (its own fail-fast/config-selection behavior is already
 * covered by `libs/ai`'s `ai-provider.factory.spec.ts`) so this spec covers only what
 * `createAIProviderProvider` itself adds: deferring the real construction call until the first
 * `generateEmbedding` invocation, and memoizing the result afterward -- the behavior that lets a
 * missing/invalid AI config break only `GET /api/papers/search/semantic`, never the whole
 * apps/api server at boot (see the provider's own doc comment for the full reasoning).
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
    };
    mockedCreateAIProvider.mockReturnValue(fakeConcreteProvider);
    const aiProvider = buildLazyProvider();

    await aiProvider.generateEmbedding('first');
    await aiProvider.generateEmbedding('second');

    expect(mockedCreateAIProvider).toHaveBeenCalledTimes(1);
    expect(fakeConcreteProvider.generateEmbedding).toHaveBeenNthCalledWith(1, 'first');
    expect(fakeConcreteProvider.generateEmbedding).toHaveBeenNthCalledWith(2, 'second');
  });
});
