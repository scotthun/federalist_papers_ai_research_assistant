const invoke = jest.fn();
const withStructuredOutput = jest.fn(() => ({ invoke }));

jest.mock('@langchain/groq', () => ({
  ChatGroq: jest.fn().mockImplementation(() => ({
    withStructuredOutput,
  })),
}));

// Imported after the mock so the class under test picks up the mocked SDK.
import { ChatGroq } from '@langchain/groq';
import { z } from 'zod';
import { ProviderUnavailableError } from '../ai-provider.interface';
import { GroqProvider } from './groq.provider';

describe('GroqProvider', () => {
  beforeEach(() => {
    invoke.mockReset();
    withStructuredOutput.mockClear();
    jest.mocked(ChatGroq).mockClear();
  });

  it('throws if constructed without an API key', () => {
    expect(() => new GroqProvider({ apiKey: '' })).toThrow(/apiKey/);
  });

  it('constructs the underlying chat model with the given API key, the default model, and maxRetries: 0', () => {
    new GroqProvider({ apiKey: 'test-key' });

    // maxRetries: 0 is pinned here too -- @langchain/core's AsyncCaller otherwise defaults to 6
    // silent internal retries, which would violate "never retries internally -- one model call per
    // invocation" at runtime even though the mocks below can't themselves exercise that retry
    // machinery (mirrors gemini.provider.spec.ts's/openrouter.provider.spec.ts's identical
    // assertion).
    expect(jest.mocked(ChatGroq)).toHaveBeenCalledWith({
      model: 'openai/gpt-oss-120b',
      apiKey: 'test-key',
      maxRetries: 0,
    });
  });

  it('overrides the default model when one is passed', () => {
    new GroqProvider({ apiKey: 'test-key', model: 'llama-3.3-70b-versatile' });

    expect(jest.mocked(ChatGroq)).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'llama-3.3-70b-versatile' }),
    );
  });

  describe('generateStructuredOutput', () => {
    const outputSchema = z.object({
      answer: z.string(),
      citations: z.array(z.object({ chunkId: z.string() })),
    });

    it('builds a structured-output runnable from the passed Zod schema and invokes it with a system/human message pair', async () => {
      invoke.mockResolvedValue({ answer: 'Grounded answer.', citations: [{ chunkId: 'c1' }] });
      const provider = new GroqProvider({ apiKey: 'test-key' });

      await provider.generateStructuredOutput({
        systemInstruction: 'Answer only from the evidence.',
        prompt: 'QUESTION: why?',
        schema: outputSchema,
      });

      // Pins that the schema handed to LangChain is the caller's own Zod schema, not some
      // internal reshaping of it -- matching this method's "the real contract is the Zod
      // validation, not the SDK's own schema hinting" guarantee (mirrors GeminiProvider's/
      // OpenRouterProvider's identical test).
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
      const provider = new GroqProvider({ apiKey: 'test-key' });

      const result = await provider.generateStructuredOutput({
        systemInstruction: 'sys',
        prompt: 'prompt',
        schema: outputSchema,
      });

      expect(result).toEqual({ answer: 'Grounded answer.', citations: [{ chunkId: 'c1' }] });
    });

    // This is the load-bearing case: even though LangChain does its own schema-hinted parsing
    // internally (and Groq's own strict-mode guarantee is stronger than most providers'), the
    // response is always re-validated against the real Zod schema afterward -- never trusted just
    // because the Runnable resolved (mirrors GeminiProvider's/OpenRouterProvider's identical test).
    it('throws a clear error if the resolved value does not satisfy the Zod schema, making exactly one call', async () => {
      invoke.mockResolvedValue({ answer: 'Missing citations field entirely.' });
      const provider = new GroqProvider({ apiKey: 'test-key' });

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
      const provider = new GroqProvider({ apiKey: 'test-key' });

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

    // Classifies by groq-sdk's APIError shape (.status/.error/.headers), which @langchain/groq
    // re-throws verbatim (confirmed by reading groq-sdk's own core/error.ts during this story's
    // implementation: APIError.generate builds one of these subclasses straight from the HTTP
    // response, byte-for-byte the same shape as the openai SDK's APIError that
    // classifyOpenRouterError targets).
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
        const provider = new GroqProvider({ apiKey: 'test-key' });

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
        const provider = new GroqProvider({ apiKey: 'test-key' });

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
            { message: 'Rate limit exceeded: 30 requests per minute' },
            { get: (name: string) => (name === 'retry-after' ? '18' : null) },
          ),
        );
        const provider = new GroqProvider({ apiKey: 'test-key' });

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
        const provider = new GroqProvider({ apiKey: 'test-key' });

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
        const provider = new GroqProvider({ apiKey: 'test-key' });

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
        const provider = new GroqProvider({ apiKey: 'test-key' });

        const promise = provider.generateStructuredOutput({
          systemInstruction: 'sys',
          prompt: 'prompt',
          schema: outputSchema,
        });

        await promise.catch((err) => {
          expect(err.kind).toBe('client_error');
        });
      });

      // spec-conversation-history-context.md: a too-long conversation (question + evidence +
      // full history) rejected by the model gets its own honest kind. Groq's OpenAI-compatible
      // error body has no dedicated status/field for this any more than OpenRouter's/Gemini's
      // does, so it's detected by matching the error body's message wording.
      describe('context_length_exceeded (spec-conversation-history-context.md)', () => {
        it('classifies a 400 whose error message mentions context length as context_length_exceeded, not client_error', async () => {
          invoke.mockRejectedValue(
            apiError(400, { message: 'This model\'s maximum context length is 8192 tokens.' }),
          );
          const provider = new GroqProvider({ apiKey: 'test-key' });

          const promise = provider.generateStructuredOutput({
            systemInstruction: 'sys',
            prompt: 'prompt',
            schema: outputSchema,
          });

          await promise.catch((err) => {
            expect(err.kind).toBe('context_length_exceeded');
            expect(err.kind).not.toBe('client_error');
          });
        });

        it('still classifies an ordinary 400 with no context-length wording as client_error', async () => {
          invoke.mockRejectedValue(apiError(400, { message: 'invalid request body' }));
          const provider = new GroqProvider({ apiKey: 'test-key' });

          const promise = provider.generateStructuredOutput({
            systemInstruction: 'sys',
            prompt: 'prompt',
            schema: outputSchema,
          });

          await promise.catch((err) => {
            expect(err.kind).toBe('client_error');
          });
        });

        // Confirmed live (2026-09-06): a grounded-RAG prompt (evidence + conversation history)
        // exceeding Groq's small free-tier tokens-per-minute (TPM) budget for openai/gpt-oss-120b
        // comes back as a 413, not a 400/429, with wording ("Request too large ... please reduce
        // your message size") the original context-length regex didn't match -- it fell through to
        // the generic client_error bucket, misleadingly telling the user "a developer needs to look
        // at this" for what is functionally the same "conversation got too long" case
        // context_length_exceeded already exists for.
        it('classifies a 413 "request too large" (Groq\'s TPM-budget wording) as context_length_exceeded, not client_error', async () => {
          invoke.mockRejectedValue(
            apiError(413, {
              message:
                'Request too large for model `openai/gpt-oss-120b` ... on tokens per minute (TPM): Limit 8000, Requested 11693, please reduce your message size and try again.',
            }),
          );
          const provider = new GroqProvider({ apiKey: 'test-key' });

          const promise = provider.generateStructuredOutput({
            systemInstruction: 'sys',
            prompt: 'prompt',
            schema: outputSchema,
          });

          await promise.catch((err) => {
            expect(err.kind).toBe('context_length_exceeded');
            expect(err.kind).not.toBe('client_error');
          });
        });
      });
    });

    it('never retries internally -- exactly one invoke call per invocation', async () => {
      invoke.mockRejectedValue(new Error('unusable response'));
      const provider = new GroqProvider({ apiKey: 'test-key' });

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
