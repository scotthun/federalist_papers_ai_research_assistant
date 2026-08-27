const embedContent = jest.fn();
const generateContent = jest.fn();

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { embedContent, generateContent },
  })),
}));

// Imported after the mock so the class under test picks up the mocked SDK.
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { GeminiProvider } from './gemini.provider';

describe('GeminiProvider', () => {
  beforeEach(() => {
    embedContent.mockReset();
    generateContent.mockReset();
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

  describe('generateStructuredOutput', () => {
    const outputSchema = z.object({
      answer: z.string(),
      citations: z.array(z.object({ chunkId: z.string() })),
    });

    it('calls generateContent with JSON-mode config and a JSON Schema built from the passed Zod schema', async () => {
      generateContent.mockResolvedValue({
        text: JSON.stringify({ answer: 'Grounded answer.', citations: [{ chunkId: 'c1' }] }),
      });
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      await provider.generateStructuredOutput({
        systemInstruction: 'Answer only from the evidence.',
        prompt: 'QUESTION: why?',
        schema: outputSchema,
      });

      expect(generateContent).toHaveBeenCalledTimes(1);
      const [call] = generateContent.mock.calls[0];
      // Pins the exact generation model string, matching the embedding test's equivalent
      // `model: 'gemini-embedding-001'` assertion above -- without this, the model used for
      // generation could silently drift with no test catching it.
      expect(call.model).toBe('gemini-3.6-flash');
      expect(call.contents).toBe('QUESTION: why?');
      expect(call.config.systemInstruction).toBe('Answer only from the evidence.');
      expect(call.config.responseMimeType).toBe('application/json');
      // Not asserting on the exact JSON Schema shape (that's z.toJSONSchema's own contract) --
      // just that a schema hint derived from the passed Zod schema was actually sent, matching
      // this method's "responseJsonSchema, always re-validated afterward" contract.
      expect(call.config.responseJsonSchema).toBeDefined();
      expect(call.config.responseJsonSchema.properties.answer).toBeDefined();
    });

    it('returns the parsed-and-validated JSON on a schema-valid response', async () => {
      generateContent.mockResolvedValue({
        text: JSON.stringify({ answer: 'Grounded answer.', citations: [{ chunkId: 'c1' }] }),
      });
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      const result = await provider.generateStructuredOutput({
        systemInstruction: 'sys',
        prompt: 'prompt',
        schema: outputSchema,
      });

      expect(result).toEqual({ answer: 'Grounded answer.', citations: [{ chunkId: 'c1' }] });
    });

    it('throws a clear error if Gemini returns no text', async () => {
      generateContent.mockResolvedValue({ text: undefined });
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      await expect(
        provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        }),
      ).rejects.toThrow(/no text response/);
    });

    it('throws a clear error if Gemini returns text that is not valid JSON', async () => {
      generateContent.mockResolvedValue({ text: 'not json at all' });
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      await expect(
        provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        }),
      ).rejects.toThrow(/not valid JSON/);
    });

    // This is the load-bearing case: even though the SDK was given a schema hint, the response
    // is always re-validated against the real Zod schema afterward -- never trusted just because
    // it parsed as JSON (this story's Boundaries: "always re-validated ... regardless of what the
    // SDK's own schema hinting does").
    it('throws a clear error if Gemini returns JSON that does not satisfy the Zod schema', async () => {
      generateContent.mockResolvedValue({
        text: JSON.stringify({ answer: 'Missing citations field entirely.' }),
      });
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      await expect(
        provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        }),
      ).rejects.toThrow(/failed schema validation/);
    });

    // Distinct from the "bad/missing/invalid-JSON text" cases above, which all cover
    // generateContent *resolving* with an unusable value -- this covers the underlying SDK call
    // itself *rejecting* (e.g. a network error), proving that rejection propagates through
    // generateStructuredOutput as-is rather than being swallowed or re-wrapped into a different
    // error.
    it('propagates a rejection from the underlying generateContent call as-is', async () => {
      const networkError = new Error('network error: ECONNRESET');
      generateContent.mockRejectedValue(networkError);
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      await expect(
        provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        }),
      ).rejects.toBe(networkError);
    });

    it('never retries internally -- exactly one generateContent call per invocation', async () => {
      generateContent.mockResolvedValue({ text: 'not json' });
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      await expect(
        provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        }),
      ).rejects.toThrow();
      expect(generateContent).toHaveBeenCalledTimes(1);
    });
  });
});
