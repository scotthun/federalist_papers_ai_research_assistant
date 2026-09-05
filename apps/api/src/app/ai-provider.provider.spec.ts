import type { EmbeddingProvider, GenerationProvider } from '@federalist-research/ai';

/**
 * Fakes `createEmbeddingProvider`/`createGenerationProvider` entirely (their own fail-fast/config-
 * selection behavior is already covered by `libs/ai`'s `ai-provider.factory.spec.ts`) so this spec
 * covers only what `createEmbeddingProviderProvider`/`createGenerationProviderProvider` themselves
 * add: deferring the real construction call until the first `generateEmbedding`/
 * `generateStructuredOutput` invocation, and memoizing the result afterward -- the behavior that
 * lets a missing/invalid AI config break only the specific route/tier that needed it, never the
 * whole apps/api server at boot (see each provider's own doc comment for the full reasoning).
 *
 * Originally one `createAIProviderProvider`/`AI_PROVIDER` token covering both methods on a single
 * combined provider (Story 3.1) -- split in two (spec-openrouter-provider.md's Spec Change Log,
 * 2026-09-05) once `AskModule` needed a generation provider that could be OpenRouter while its
 * embedding calls still always need Gemini. Each half now memoizes its own construction
 * independently -- there is no longer a single shared cache between them.
 */
jest.mock('@federalist-research/ai', () => ({
  createEmbeddingProvider: jest.fn(),
  createGenerationProvider: jest.fn(),
}));

import { createEmbeddingProvider, createGenerationProvider } from '@federalist-research/ai';
import {
  EMBEDDING_PROVIDER,
  GENERATION_PROVIDER,
  createEmbeddingProviderProvider,
  createGenerationProviderProvider,
} from './ai-provider.provider';

const mockedCreateEmbeddingProvider = createEmbeddingProvider as jest.Mock;
const mockedCreateGenerationProvider = createGenerationProvider as jest.Mock;

describe('createEmbeddingProviderProvider', () => {
  beforeEach(() => {
    mockedCreateEmbeddingProvider.mockReset();
  });

  function buildLazyProvider(): EmbeddingProvider {
    const provider = createEmbeddingProviderProvider() as {
      provide: string;
      useFactory: () => EmbeddingProvider;
    };
    expect(provider.provide).toBe(EMBEDDING_PROVIDER);
    return provider.useFactory();
  }

  it('never calls createEmbeddingProvider at factory-construction time', () => {
    mockedCreateEmbeddingProvider.mockImplementation(() => {
      throw new Error('GEMINI_API_KEY is not set');
    });

    expect(() => buildLazyProvider()).not.toThrow();
    expect(mockedCreateEmbeddingProvider).not.toHaveBeenCalled();
  });

  it('rejects generateEmbedding with the same error createEmbeddingProvider throws', async () => {
    mockedCreateEmbeddingProvider.mockImplementation(() => {
      throw new Error('GEMINI_API_KEY is not set');
    });
    const embeddingProvider = buildLazyProvider();

    await expect(embeddingProvider.generateEmbedding('a query')).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
  });

  it('retries construction on the next call rather than caching a failed attempt as success', async () => {
    mockedCreateEmbeddingProvider.mockImplementation(() => {
      throw new Error('still broken');
    });
    const embeddingProvider = buildLazyProvider();

    await expect(embeddingProvider.generateEmbedding('first')).rejects.toThrow('still broken');
    await expect(embeddingProvider.generateEmbedding('second')).rejects.toThrow('still broken');
    expect(mockedCreateEmbeddingProvider).toHaveBeenCalledTimes(2);
  });

  it('constructs the real provider lazily and memoizes it across multiple generateEmbedding calls', async () => {
    const fakeConcreteProvider = {
      generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };
    mockedCreateEmbeddingProvider.mockReturnValue(fakeConcreteProvider);
    const embeddingProvider = buildLazyProvider();

    await embeddingProvider.generateEmbedding('first');
    await embeddingProvider.generateEmbedding('second');

    expect(mockedCreateEmbeddingProvider).toHaveBeenCalledTimes(1);
    expect(fakeConcreteProvider.generateEmbedding).toHaveBeenNthCalledWith(1, 'first');
    expect(fakeConcreteProvider.generateEmbedding).toHaveBeenNthCalledWith(2, 'second');
  });
});

describe('createGenerationProviderProvider', () => {
  beforeEach(() => {
    mockedCreateGenerationProvider.mockReset();
  });

  function buildLazyProvider(): GenerationProvider {
    const provider = createGenerationProviderProvider() as {
      provide: string;
      useFactory: () => GenerationProvider;
    };
    expect(provider.provide).toBe(GENERATION_PROVIDER);
    return provider.useFactory();
  }

  it('never calls createGenerationProvider at factory-construction time', () => {
    mockedCreateGenerationProvider.mockImplementation(() => {
      throw new Error('GEMINI_API_KEY is not set');
    });

    expect(() => buildLazyProvider()).not.toThrow();
    expect(mockedCreateGenerationProvider).not.toHaveBeenCalled();
  });

  it('rejects generateStructuredOutput with the same error createGenerationProvider throws', async () => {
    mockedCreateGenerationProvider.mockImplementation(() => {
      throw new Error('GEMINI_API_KEY is not set');
    });
    const generationProvider = buildLazyProvider();

    await expect(
      generationProvider.generateStructuredOutput({
        systemInstruction: 'sys',
        prompt: 'prompt',
        schema: { safeParse: jest.fn() } as never,
      }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });

  it('retries construction on the next call rather than caching a failed attempt as success', async () => {
    mockedCreateGenerationProvider.mockImplementation(() => {
      throw new Error('still broken');
    });
    const generationProvider = buildLazyProvider();

    await expect(
      generationProvider.generateStructuredOutput({
        systemInstruction: 'sys',
        prompt: 'prompt',
        schema: { safeParse: jest.fn() } as never,
      }),
    ).rejects.toThrow('still broken');
    await expect(
      generationProvider.generateStructuredOutput({
        systemInstruction: 'sys',
        prompt: 'prompt',
        schema: { safeParse: jest.fn() } as never,
      }),
    ).rejects.toThrow('still broken');
    expect(mockedCreateGenerationProvider).toHaveBeenCalledTimes(2);
  });

  it('constructs the real provider lazily and memoizes it across multiple generateStructuredOutput calls', async () => {
    const fakeConcreteProvider = {
      generateStructuredOutput: jest.fn().mockResolvedValue({ answer: 'ok', citations: [] }),
    };
    mockedCreateGenerationProvider.mockReturnValue(fakeConcreteProvider);
    const generationProvider = buildLazyProvider();

    await generationProvider.generateStructuredOutput({
      systemInstruction: 'sys',
      prompt: 'first',
      schema: { safeParse: jest.fn() } as never,
    });
    await generationProvider.generateStructuredOutput({
      systemInstruction: 'sys',
      prompt: 'second',
      schema: { safeParse: jest.fn() } as never,
    });

    expect(mockedCreateGenerationProvider).toHaveBeenCalledTimes(1);
    expect(fakeConcreteProvider.generateStructuredOutput).toHaveBeenCalledTimes(2);
  });
});
