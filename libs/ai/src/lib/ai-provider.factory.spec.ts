jest.mock('@google/genai', () => ({
  GoogleGenAI: jest
    .fn()
    .mockImplementation(() => ({ models: { embedContent: jest.fn() } })),
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
});
