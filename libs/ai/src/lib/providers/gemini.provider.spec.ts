const embedQuery = jest.fn();
const invoke = jest.fn();
const withStructuredOutput = jest.fn(() => ({ invoke }));

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput,
  })),
  GoogleGenerativeAIEmbeddings: jest.fn().mockImplementation(() => ({
    embedQuery,
  })),
}));

// Imported after the mock so the class under test picks up the mocked SDK.
import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { z } from 'zod';
import { ProviderUnavailableError } from '../ai-provider.interface';
import { GeminiProvider } from './gemini.provider';

describe('GeminiProvider', () => {
  beforeEach(() => {
    embedQuery.mockReset();
    invoke.mockReset();
    withStructuredOutput.mockClear();
    jest.mocked(ChatGoogleGenerativeAI).mockClear();
    jest.mocked(GoogleGenerativeAIEmbeddings).mockClear();
  });

  it('throws if constructed without an API key', () => {
    expect(() => new GeminiProvider({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('constructs the underlying chat model and embeddings client with the given API key', () => {
    new GeminiProvider({ apiKey: 'test-key' });

    // maxRetries: 0 is pinned here too -- @langchain/core's AsyncCaller otherwise defaults to 6
    // silent internal retries, which would violate "never retries internally" at runtime even
    // though the mocks below can't themselves exercise that retry machinery.
    expect(jest.mocked(ChatGoogleGenerativeAI)).toHaveBeenCalledWith({
      model: 'gemini-3.6-flash',
      apiKey: 'test-key',
      maxRetries: 0,
    });
    expect(jest.mocked(GoogleGenerativeAIEmbeddings)).toHaveBeenCalledWith({
      model: 'gemini-embedding-001',
      apiKey: 'test-key',
      maxRetries: 0,
    });
  });

  const validEmbedding = Array.from({ length: 3072 }, (_, i) => i / 3072);

  it('calls embedQuery with the gemini-embedding-001 model and returns the embedding values', async () => {
    embedQuery.mockResolvedValue(validEmbedding);
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    const result = await provider.generateEmbedding('some text');

    expect(embedQuery).toHaveBeenCalledWith('some text');
    expect(result).toEqual(validEmbedding);
  });

  it('throws a clear error if Gemini returns no embedding values', async () => {
    embedQuery.mockResolvedValue([]);
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    await expect(provider.generateEmbedding('some text')).rejects.toThrow(
      /no embedding values/,
    );
  });

  it('throws a clear error naming both dimensions if Gemini returns the wrong embedding size', async () => {
    embedQuery.mockResolvedValue([0.1, 0.2, 0.3]);
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    await expect(provider.generateEmbedding('some text')).rejects.toThrow(
      /3 dimensions, expected 3072/,
    );
  });

  it('propagates a rejection from the underlying embedQuery call as-is', async () => {
    const networkError = new Error('network error: ECONNRESET');
    embedQuery.mockRejectedValue(networkError);
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    await expect(provider.generateEmbedding('some text')).rejects.toBe(networkError);
  });

  describe('generateStructuredOutput', () => {
    const outputSchema = z.object({
      answer: z.string(),
      citations: z.array(z.object({ chunkId: z.string() })),
    });

    it('builds a structured-output runnable from the passed Zod schema and invokes it with a system/human message pair', async () => {
      invoke.mockResolvedValue({ answer: 'Grounded answer.', citations: [{ chunkId: 'c1' }] });
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      await provider.generateStructuredOutput({
        systemInstruction: 'Answer only from the evidence.',
        prompt: 'QUESTION: why?',
        schema: outputSchema,
      });

      // Pins that the schema handed to LangChain is the caller's own Zod schema, not some
      // internal reshaping of it -- matching this method's "the real contract is the Zod
      // validation, not the SDK's own schema hinting" guarantee.
      expect(withStructuredOutput).toHaveBeenCalledTimes(1);
      expect(withStructuredOutput).toHaveBeenCalledWith(outputSchema);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith([
        ['system', 'Answer only from the evidence.'],
        ['human', 'QUESTION: why?'],
      ]);
    });

    it('returns the parsed-and-validated JSON on a schema-valid response', async () => {
      invoke.mockResolvedValue({ answer: 'Grounded answer.', citations: [{ chunkId: 'c1' }] });
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      const result = await provider.generateStructuredOutput({
        systemInstruction: 'sys',
        prompt: 'prompt',
        schema: outputSchema,
      });

      expect(result).toEqual({ answer: 'Grounded answer.', citations: [{ chunkId: 'c1' }] });
    });

    // This is the load-bearing case: even though LangChain does its own schema-hinted parsing
    // internally, the response is always re-validated against the real Zod schema afterward --
    // never trusted just because the Runnable resolved (this story's Boundaries: "always
    // re-validated ... regardless of what schema hinting the underlying SDK supports").
    it('throws a clear error if the resolved value does not satisfy the Zod schema, making exactly one call', async () => {
      invoke.mockResolvedValue({ answer: 'Missing citations field entirely.' });
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      await expect(
        provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        }),
      ).rejects.toThrow(/failed schema validation/);
      // Matrix's "exactly one call made" guarantee for this scenario specifically -- distinct
      // from the invoke-rejects scenario below, which is a separate row in the matrix.
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    // Distinct from the schema-validation-failure case above, which covers the Runnable
    // *resolving* with an unusable value -- this covers the underlying call itself *rejecting*
    // (e.g. a network error, or LangChain's own parser finding no usable tool call). Wrapped in
    // ProviderUnavailableError (not re-thrown as-is) so callers can distinguish "the provider was
    // never reached" from "the provider responded with something unusable" (2026-09-03,
    // ask.service.ts's honest "model unavailable" vs "insufficient evidence" messaging).
    it('wraps a rejection from the underlying invoke call in ProviderUnavailableError, preserving the message and original error as cause', async () => {
      const networkError = new Error('network error: ECONNRESET');
      invoke.mockRejectedValue(networkError);
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      const promise = provider.generateStructuredOutput({
        systemInstruction: 'sys',
        prompt: 'prompt',
        schema: outputSchema,
      });

      await expect(promise).rejects.toBeInstanceOf(ProviderUnavailableError);
      await expect(promise).rejects.toThrow('network error: ECONNRESET');
      await promise.catch((err) => {
        expect(err.cause).toBe(networkError);
      });
    });

    it('never retries internally -- exactly one invoke call per invocation', async () => {
      invoke.mockRejectedValue(new Error('unusable response'));
      const provider = new GeminiProvider({ apiKey: 'test-key' });

      await expect(
        provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        }),
      ).rejects.toThrow();
      expect(invoke).toHaveBeenCalledTimes(1);
    });
  });
});
