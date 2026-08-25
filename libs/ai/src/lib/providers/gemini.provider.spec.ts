const embedContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { embedContent },
  })),
}));

// Imported after the mock so the class under test picks up the mocked SDK.
import { GoogleGenAI } from '@google/genai';
import { GeminiProvider } from './gemini.provider';

describe('GeminiProvider', () => {
  beforeEach(() => {
    embedContent.mockReset();
    (GoogleGenAI as jest.Mock).mockClear();
  });

  it('throws if constructed without an API key', () => {
    expect(() => new GeminiProvider({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('constructs the underlying SDK client with the given API key', () => {
    new GeminiProvider({ apiKey: 'test-key' });
    expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  const validEmbedding = Array.from({ length: 3072 }, (_, i) => i / 3072);

  it('calls embedContent with the gemini-embedding-001 model and returns the embedding values', async () => {
    embedContent.mockResolvedValue({
      embeddings: [{ values: validEmbedding }],
    });
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    const result = await provider.generateEmbedding('some text');

    expect(embedContent).toHaveBeenCalledWith({
      model: 'gemini-embedding-001',
      contents: 'some text',
    });
    expect(result).toEqual(validEmbedding);
  });

  it('throws a clear error if Gemini returns no embedding values', async () => {
    embedContent.mockResolvedValue({ embeddings: [] });
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    await expect(provider.generateEmbedding('some text')).rejects.toThrow(
      /no embedding values/,
    );
  });

  it('throws a clear error naming both dimensions if Gemini returns the wrong embedding size', async () => {
    embedContent.mockResolvedValue({
      embeddings: [{ values: [0.1, 0.2, 0.3] }],
    });
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    await expect(provider.generateEmbedding('some text')).rejects.toThrow(
      /3 dimensions, expected 3072/,
    );
  });
});
