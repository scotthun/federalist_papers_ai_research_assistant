const chatModelCtor = jest.fn().mockImplementation(() => ({}));

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: chatModelCtor,
  GoogleGenerativeAIEmbeddings: jest.fn().mockImplementation(() => ({})),
}));

const openAiChatModelCtor = jest.fn().mockImplementation(() => ({}));

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: openAiChatModelCtor,
}));

const groqChatModelCtor = jest.fn().mockImplementation(() => ({}));

jest.mock('@langchain/groq', () => ({
  ChatGroq: groqChatModelCtor,
}));

import { createEmbeddingProvider, createGenerationProvider } from './ai-provider.factory';
import { GeminiProvider } from './providers/gemini.provider';
import { GroqProvider } from './providers/groq.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';

describe('createEmbeddingProvider', () => {
  it('always returns a GeminiProvider, regardless of AI_PROVIDER', () => {
    const provider = createEmbeddingProvider({
      AI_PROVIDER: 'openrouter',
      GEMINI_API_KEY: 'test-key',
      OPENROUTER_API_KEY: 'or-key',
    });
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('throws a clear error naming GEMINI_API_KEY when it is missing, even if AI_PROVIDER is unset', () => {
    expect(() => createEmbeddingProvider({})).toThrow(/GEMINI_API_KEY/);
  });

  it("passes GEMINI_GENERATION_MODEL through to the underlying chat model when set (GeminiProvider's own generation model, unrelated to the embedding model)", () => {
    createEmbeddingProvider({
      GEMINI_API_KEY: 'test-key',
      GEMINI_GENERATION_MODEL: 'gemini-2.5-flash-lite',
    });

    expect(chatModelCtor).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash-lite' }),
    );
  });
});

describe('createGenerationProvider', () => {
  it('defaults to gemini when AI_PROVIDER is unset', () => {
    const provider = createGenerationProvider({ GEMINI_API_KEY: 'test-key' });
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('returns a GeminiProvider when AI_PROVIDER=gemini', () => {
    const provider = createGenerationProvider({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
    });
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('throws a clear error when gemini is selected but GEMINI_API_KEY is missing', () => {
    expect(() => createGenerationProvider({ AI_PROVIDER: 'gemini' })).toThrow(
      /GEMINI_API_KEY/,
    );
  });

  it('throws a clear error for an unsupported provider', () => {
    expect(() => createGenerationProvider({ AI_PROVIDER: 'openai' })).toThrow(
      /Unknown AI_PROVIDER/,
    );
  });

  // 2026-09-03: lets a specific model's live unavailability be worked around by restarting with
  // a different env value, without editing source.
  it('passes GEMINI_GENERATION_MODEL through to the underlying chat model when set', () => {
    createGenerationProvider({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
      GEMINI_GENERATION_MODEL: 'gemini-2.5-flash-lite',
    });

    expect(chatModelCtor).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash-lite' }),
    );
  });

  it("falls back to GeminiProvider's own default model when GEMINI_GENERATION_MODEL is unset", () => {
    createGenerationProvider({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key' });

    expect(chatModelCtor).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.6-flash' }),
    );
  });

  describe('openrouter', () => {
    it('returns an OpenRouterProvider when AI_PROVIDER=openrouter', () => {
      const provider = createGenerationProvider({
        AI_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'or-key',
      });
      expect(provider).toBeInstanceOf(OpenRouterProvider);
    });

    it('throws a clear error naming OPENROUTER_API_KEY when it is missing', () => {
      expect(() => createGenerationProvider({ AI_PROVIDER: 'openrouter' })).toThrow(
        /OPENROUTER_API_KEY/,
      );
    });

    it("constructs ChatOpenAI with OpenRouterProvider's own default free Nemotron model when OPENROUTER_MODEL is unset", () => {
      createGenerationProvider({
        AI_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'or-key',
      });

      expect(openAiChatModelCtor).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'nvidia/nemotron-3-super-120b-a12b:free' }),
      );
    });

    it('passes OPENROUTER_MODEL through to the underlying chat model when set', () => {
      createGenerationProvider({
        AI_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'or-key',
        OPENROUTER_MODEL: 'some/other:free',
      });

      expect(openAiChatModelCtor).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'some/other:free' }),
      );
    });

    it("constructs ChatOpenAI with OpenRouter's baseURL and the given API key", () => {
      createGenerationProvider({
        AI_PROVIDER: 'openrouter',
        OPENROUTER_API_KEY: 'or-key',
      });

      expect(openAiChatModelCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'or-key',
          configuration: { baseURL: 'https://openrouter.ai/api/v1' },
          maxRetries: 0,
        }),
      );
    });
  });

  describe('groq', () => {
    it('returns a GroqProvider when AI_PROVIDER=groq', () => {
      const provider = createGenerationProvider({
        AI_PROVIDER: 'groq',
        GROQ_API_KEY: 'groq-key',
      });
      expect(provider).toBeInstanceOf(GroqProvider);
    });

    it('throws a clear error naming GROQ_API_KEY when it is missing', () => {
      expect(() => createGenerationProvider({ AI_PROVIDER: 'groq' })).toThrow(/GROQ_API_KEY/);
    });

    it("constructs ChatGroq with GroqProvider's own default model when GROQ_MODEL is unset", () => {
      createGenerationProvider({
        AI_PROVIDER: 'groq',
        GROQ_API_KEY: 'groq-key',
      });

      expect(groqChatModelCtor).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'openai/gpt-oss-120b' }),
      );
    });

    it('passes GROQ_MODEL through to the underlying chat model when set', () => {
      createGenerationProvider({
        AI_PROVIDER: 'groq',
        GROQ_API_KEY: 'groq-key',
        GROQ_MODEL: 'llama-3.3-70b-versatile',
      });

      expect(groqChatModelCtor).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'llama-3.3-70b-versatile' }),
      );
    });

    it('constructs ChatGroq with the given API key and maxRetries: 0', () => {
      createGenerationProvider({
        AI_PROVIDER: 'groq',
        GROQ_API_KEY: 'groq-key',
      });

      expect(groqChatModelCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'groq-key',
          maxRetries: 0,
        }),
      );
    });
  });
});
