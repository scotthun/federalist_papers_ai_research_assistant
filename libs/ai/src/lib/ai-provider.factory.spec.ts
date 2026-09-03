const chatModelCtor = jest.fn().mockImplementation(() => ({}));

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: chatModelCtor,
  GoogleGenerativeAIEmbeddings: jest.fn().mockImplementation(() => ({})),
}));

import { createAIProvider } from './ai-provider.factory';
import { GeminiProvider } from './providers/gemini.provider';

describe('createAIProvider', () => {
  it('defaults to gemini when AI_PROVIDER is unset', () => {
    const provider = createAIProvider({ GEMINI_API_KEY: 'test-key' });
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('returns a GeminiProvider when AI_PROVIDER=gemini', () => {
    const provider = createAIProvider({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
    });
    expect(provider).toBeInstanceOf(GeminiProvider);
  });

  it('throws a clear error when gemini is selected but GEMINI_API_KEY is missing', () => {
    expect(() => createAIProvider({ AI_PROVIDER: 'gemini' })).toThrow(
      /GEMINI_API_KEY/,
    );
  });

  it('throws a clear error for an unsupported provider', () => {
    expect(() => createAIProvider({ AI_PROVIDER: 'openai' })).toThrow(
      /Unknown AI_PROVIDER/,
    );
  });

  // 2026-09-03: lets a specific model's live unavailability be worked around by restarting with
  // a different env value, without editing source.
  it('passes GEMINI_GENERATION_MODEL through to the underlying chat model when set', () => {
    createAIProvider({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'test-key',
      GEMINI_GENERATION_MODEL: 'gemini-2.5-flash-lite',
    });

    expect(chatModelCtor).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash-lite' }),
    );
  });

  it("falls back to GeminiProvider's own default model when GEMINI_GENERATION_MODEL is unset", () => {
    createAIProvider({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key' });

    expect(chatModelCtor).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.6-flash' }),
    );
  });
});
