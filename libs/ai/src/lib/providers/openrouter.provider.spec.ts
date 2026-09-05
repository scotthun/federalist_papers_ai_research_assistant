const invoke = jest.fn();
const withStructuredOutput = jest.fn(() => ({ invoke }));

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput,
  })),
}));

// Imported after the mock so the class under test picks up the mocked SDK.
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { ProviderUnavailableError } from '../ai-provider.interface';
import { OpenRouterProvider } from './openrouter.provider';

describe('OpenRouterProvider', () => {
  beforeEach(() => {
    invoke.mockReset();
    withStructuredOutput.mockClear();
    jest.mocked(ChatOpenAI).mockClear();
  });

  it('throws if constructed without an API key', () => {
    expect(() => new OpenRouterProvider({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('constructs the underlying chat model with the given API key, OpenRouter baseURL, the default model, and maxRetries: 0', () => {
    new OpenRouterProvider({ apiKey: 'test-key' });

    // maxRetries: 0 is pinned here too -- @langchain/core's AsyncCaller otherwise defaults to 6
    // silent internal retries, which would violate "never retries internally" at runtime even
    // though the mocks below can't themselves exercise that retry machinery (mirrors
    // gemini.provider.spec.ts's identical assertion for GeminiProvider).
    expect(jest.mocked(ChatOpenAI)).toHaveBeenCalledWith({
      model: 'nvidia/nemotron-3-super-120b-a12b:free',
      apiKey: 'test-key',
      configuration: { baseURL: 'https://openrouter.ai/api/v1' },
      maxRetries: 0,
    });
  });

  it('overrides the default model when one is passed', () => {
    new OpenRouterProvider({ apiKey: 'test-key', model: 'some/other:free' });

    expect(jest.mocked(ChatOpenAI)).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'some/other:free' }),
    );
  });

  describe('generateStructuredOutput', () => {
    const outputSchema = z.object({
      answer: z.string(),
      citations: z.array(z.object({ chunkId: z.string() })),
    });

    it('builds a structured-output runnable from the passed Zod schema and invokes it with a system/human message pair', async () => {
      invoke.mockResolvedValue({ answer: 'Grounded answer.', citations: [{ chunkId: 'c1' }] });
      const provider = new OpenRouterProvider({ apiKey: 'test-key' });

      await provider.generateStructuredOutput({
        systemInstruction: 'Answer only from the evidence.',
        prompt: 'QUESTION: why?',
        schema: outputSchema,
      });

      // Pins that the schema handed to LangChain is the caller's own Zod schema, not some
      // internal reshaping of it -- matching this method's "the real contract is the Zod
      // validation, not the SDK's own schema hinting" guarantee (mirrors GeminiProvider's
      // identical test).
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
      const provider = new OpenRouterProvider({ apiKey: 'test-key' });

      const result = await provider.generateStructuredOutput({
        systemInstruction: 'sys',
        prompt: 'prompt',
        schema: outputSchema,
      });

      expect(result).toEqual({ answer: 'Grounded answer.', citations: [{ chunkId: 'c1' }] });
    });

    // This is the load-bearing case: even though LangChain does its own schema-hinted parsing
    // internally, the response is always re-validated against the real Zod schema afterward --
    // never trusted just because the Runnable resolved (mirrors GeminiProvider's identical test).
    it('throws a clear error if the resolved value does not satisfy the Zod schema, making exactly one call', async () => {
      invoke.mockResolvedValue({ answer: 'Missing citations field entirely.' });
      const provider = new OpenRouterProvider({ apiKey: 'test-key' });

      await expect(
        provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        }),
      ).rejects.toThrow(/failed schema validation/);
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('wraps a rejection from the underlying invoke call in ProviderUnavailableError, preserving the message and original error as cause', async () => {
      const networkError = new Error('network error: ECONNRESET');
      invoke.mockRejectedValue(networkError);
      const provider = new OpenRouterProvider({ apiKey: 'test-key' });

      const promise = provider.generateStructuredOutput({
        systemInstruction: 'sys',
        prompt: 'prompt',
        schema: outputSchema,
      });

      await expect(promise).rejects.toBeInstanceOf(ProviderUnavailableError);
      await expect(promise).rejects.toThrow('network error: ECONNRESET');
      await promise.catch((err) => {
        expect(err.cause).toBe(networkError);
        // No HTTP status at all (a plain network error) -- classified as 'unavailable', the
        // catch-all for "never even got a response to classify by status".
        expect(err.kind).toBe('unavailable');
      });
    });

    // Classifies by the openai SDK's APIError shape (.status/.error/.headers), which
    // @langchain/openai re-throws verbatim (confirmed by reading its dependency openai's own
    // core/error.ts: APIError.generate builds one of these subclasses straight from the HTTP
    // response). This story's Boundaries: OpenRouter's free-tier rate limits are account-level,
    // not per-model -- a 429 whose body indicates the daily cap classifies as
    // 'rate_limited_daily', a plain per-minute 429 as 'rate_limited_short'.
    describe('error classification (ProviderFailureKind)', () => {
      function apiError(
        status: number,
        error?: { message?: string; code?: string | number },
        headers?: { get(name: string): string | null },
      ) {
        const err = new Error(`${status} boom`);
        return Object.assign(err, { status, error, headers });
      }

      it('classifies 503 as overloaded', async () => {
        invoke.mockRejectedValue(apiError(503));
        const provider = new OpenRouterProvider({ apiKey: 'test-key' });

        const promise = provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        });

        await promise.catch((err) => {
          expect(err.kind).toBe('overloaded');
        });
      });

      it('classifies a 429 whose error message names the daily/free-tier cap as rate_limited_daily', async () => {
        invoke.mockRejectedValue(
          apiError(429, { message: 'Rate limit exceeded: free-tier daily limit reached' }),
        );
        const provider = new OpenRouterProvider({ apiKey: 'test-key' });

        const promise = provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        });

        await promise.catch((err) => {
          expect(err.kind).toBe('rate_limited_daily');
        });
      });

      it('classifies a 429 without a daily-cap indication as rate_limited_short, parsing a Retry-After header', async () => {
        invoke.mockRejectedValue(
          apiError(
            429,
            { message: 'Rate limit exceeded: 20 requests per minute' },
            { get: (name: string) => (name === 'retry-after' ? '18' : null) },
          ),
        );
        const provider = new OpenRouterProvider({ apiKey: 'test-key' });

        const promise = provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        });

        await promise.catch((err) => {
          expect(err.kind).toBe('rate_limited_short');
          expect(err.retryAfterSeconds).toBe(18);
        });
      });

      it('classifies a 429 with no error body/headers at all as rate_limited_short with no retry hint', async () => {
        invoke.mockRejectedValue(apiError(429));
        const provider = new OpenRouterProvider({ apiKey: 'test-key' });

        const promise = provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        });

        await promise.catch((err) => {
          expect(err.kind).toBe('rate_limited_short');
          expect(err.retryAfterSeconds).toBeUndefined();
        });
      });

      it('classifies other 5xx statuses as server_error', async () => {
        invoke.mockRejectedValue(apiError(500));
        const provider = new OpenRouterProvider({ apiKey: 'test-key' });

        const promise = provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        });

        await promise.catch((err) => {
          expect(err.kind).toBe('server_error');
        });
      });

      it('classifies 4xx statuses other than 429 (e.g. 401) as client_error', async () => {
        invoke.mockRejectedValue(apiError(401));
        const provider = new OpenRouterProvider({ apiKey: 'test-key' });

        const promise = provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        });

        await promise.catch((err) => {
          expect(err.kind).toBe('client_error');
        });
      });
    });

    it('never retries internally -- exactly one invoke call per invocation', async () => {
      invoke.mockRejectedValue(new Error('unusable response'));
      const provider = new OpenRouterProvider({ apiKey: 'test-key' });

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
