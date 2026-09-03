import { Logger } from '@nestjs/common';
import { ProviderUnavailableError, type AIProvider } from '@federalist-research/ai';
import { LlmAnswerOutputSchema } from '@federalist-research/shared';
import { DataSource } from 'typeorm';
import { CLARIFY_THRESHOLD, CONFIDENT_THRESHOLD } from './answer-thresholds';
import { AskService, PROVIDER_UNAVAILABLE_MESSAGE, REFUSE_MESSAGE } from './ask.service';

/**
 * Fakes both boundaries AskService composes through the real `retrieveRelevantChunks` (its own
 * SQL/filter correctness is covered by libs/retrieval's specs, not re-tested here) and the real
 * `AIProvider` interface -- this spec covers only AskService's own orchestration: tier
 * branching, prompt construction, citation verification, the one-retry-then-fail-safe policy,
 * and logging.
 */
function fakeAiProvider(): AIProvider {
  return {
    generateEmbedding: jest.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    generateStructuredOutput: jest.fn(),
  };
}

interface FakeRow {
  chunkId: string;
  paperNumber: number;
  paperTitle: string;
  content: string;
  score: number;
}

function fakeRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    chunkId: 'chunk-1',
    paperNumber: 51,
    paperTitle: 'The Structure of the Government',
    content: 'Ambition must be made to counteract ambition.',
    score: CONFIDENT_THRESHOLD,
    ...overrides,
  };
}

function fakeDataSource(rows: FakeRow[]): { dataSource: DataSource; query: jest.Mock } {
  const query = jest.fn().mockResolvedValue(rows);
  return { dataSource: { query } as unknown as DataSource, query };
}

function buildService(rows: FakeRow[], aiProvider: AIProvider = fakeAiProvider()) {
  const { dataSource, query } = fakeDataSource(rows);
  const service = new AskService(dataSource, aiProvider);
  return { service, aiProvider, query };
}

describe('AskService', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('confident tier', () => {
    it('calls the LLM and returns a verified answer with confidence "high" when the top score meets CONFIDENT_THRESHOLD', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'Ambition must be made to counteract ambition.',
        citations: [{ paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId: 'chunk-1' }],
      });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      // paperTitle is re-derived server-side from the actual retrieved chunk (`fakeRow`'s real
      // 'The Structure of the Government'), not trusted from the LLM's own echoed
      // 'Federalist No. 51' -- see the "re-derives citation paperNumber/paperTitle" tests below.
      expect(result).toEqual({
        answer: 'Ambition must be made to counteract ambition.',
        citations: [
          { paperNumber: 51, paperTitle: 'The Structure of the Government', chunkId: 'chunk-1' },
        ],
        confidence: 'high',
        insufficientEvidence: false,
      });
      expect(aiProvider.generateStructuredOutput).toHaveBeenCalledTimes(1);
      const call = (aiProvider.generateStructuredOutput as jest.Mock).mock.calls[0][0];
      expect(call.schema).toBe(LlmAnswerOutputSchema);
      expect(call.prompt).toContain('Why checks and balances?');
      expect(call.prompt).toContain('chunk-1');
    });

    // The load-bearing case: a fabricated chunkId the LLM invented (never part of the retrieved
    // context) must be caught and trigger a retry -- if verification were skipped, or checked
    // against the wrong set, this first, uncorrected response would be returned as-is.
    it('retries once with an explicit correction when the first response cites a chunkId outside the retrieved set, and succeeds if the retry is valid', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock)
        .mockResolvedValueOnce({
          answer: 'A fabricated answer.',
          citations: [
            { paperNumber: 999, paperTitle: 'Not Real', chunkId: 'chunk-FABRICATED' },
          ],
        })
        .mockResolvedValueOnce({
          answer: 'The corrected, grounded answer.',
          citations: [{ paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId: 'chunk-1' }],
        });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      // paperTitle re-derived from the actual retrieved chunk, same as the first-try case above.
      expect(result).toEqual({
        answer: 'The corrected, grounded answer.',
        citations: [
          { paperNumber: 51, paperTitle: 'The Structure of the Government', chunkId: 'chunk-1' },
        ],
        confidence: 'high',
        insufficientEvidence: false,
      });
      expect(aiProvider.generateStructuredOutput).toHaveBeenCalledTimes(2);
      const retryCall = (aiProvider.generateStructuredOutput as jest.Mock).mock.calls[1][0];
      expect(retryCall.prompt).toContain('CORRECTION');
      expect(retryCall.prompt).toContain('chunk-FABRICATED');
      expect(retryCall.prompt).toContain('chunk-1');
    });

    it('fails safe to the refuse-tier response when the citation is still invalid after the one retry -- never strips just the bad citation', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'Still fabricated.',
        citations: [{ paperNumber: 999, paperTitle: 'Not Real', chunkId: 'chunk-FABRICATED' }],
      });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      expect(result).toEqual({
        answer: REFUSE_MESSAGE,
        citations: [],
        confidence: 'low',
        insufficientEvidence: true,
      });
      // Exactly one retry, never more -- "one retry total", not a loop.
      expect(aiProvider.generateStructuredOutput).toHaveBeenCalledTimes(2);
    });

    it('retries once with an explicit correction when the first response is malformed/schema-invalid, and succeeds if the retry is valid', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock)
        .mockRejectedValueOnce(new Error('failed schema validation: answer: Required'))
        .mockResolvedValueOnce({
          answer: 'The corrected, grounded answer.',
          citations: [{ paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId: 'chunk-1' }],
        });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      expect(result.confidence).toBe('high');
      expect(result.answer).toBe('The corrected, grounded answer.');
      expect(aiProvider.generateStructuredOutput).toHaveBeenCalledTimes(2);
      const retryCall = (aiProvider.generateStructuredOutput as jest.Mock).mock.calls[1][0];
      expect(retryCall.prompt).toContain('CORRECTION');
      expect(retryCall.prompt).toContain('failed schema validation');
    });

    it('fails safe to the refuse-tier response when the LLM call fails on both the first attempt and the retry', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockRejectedValue(
        new Error('Gemini returned no text response'),
      );
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      expect(result).toEqual({
        answer: REFUSE_MESSAGE,
        citations: [],
        confidence: 'low',
        insufficientEvidence: true,
      });
      expect(aiProvider.generateStructuredOutput).toHaveBeenCalledTimes(2);
    });

    // 2026-09-03 third follow-up: REFUSE_MESSAGE ("I couldn't find sufficient evidence...")
    // wrongly implies a content/evidence problem when the real cause is that the AI provider
    // itself was never reached (e.g. a 503 "high demand" response) -- confusing given the
    // question and evidence were both fine. PROVIDER_UNAVAILABLE_MESSAGE says so honestly.
    it('shows PROVIDER_UNAVAILABLE_MESSAGE (not REFUSE_MESSAGE) when both attempts fail because the AI provider itself is unavailable', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockRejectedValue(
        new ProviderUnavailableError('503 Service Unavailable: high demand'),
      );
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      expect(result.answer).toBe(PROVIDER_UNAVAILABLE_MESSAGE);
      expect(result.answer).not.toBe(REFUSE_MESSAGE);
      expect(result.confidence).toBe('low');
      expect(result.insufficientEvidence).toBe(true);
      expect(aiProvider.generateStructuredOutput).toHaveBeenCalledTimes(2);
    });

    it('shows PROVIDER_UNAVAILABLE_MESSAGE when only the first attempt is a provider failure but the retry still fails a different way', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock)
        .mockRejectedValueOnce(new ProviderUnavailableError('503 Service Unavailable'))
        .mockRejectedValueOnce(new Error('Gemini returned no text response'));
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      expect(result.answer).toBe(PROVIDER_UNAVAILABLE_MESSAGE);
    });

    it('still shows REFUSE_MESSAGE (not the provider-unavailable wording) when the retry succeeds in getting a response that just fails citation verification', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock)
        .mockRejectedValueOnce(new ProviderUnavailableError('503 Service Unavailable'))
        .mockResolvedValueOnce({
          answer: 'A response with a fabricated citation.',
          citations: [{ paperNumber: 999, paperTitle: 'Not Real', chunkId: 'chunk-FABRICATED' }],
        });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      // The retry *did* get a response from the provider -- it was just ungrounded, a
      // data-quality refuse rather than a provider-outage one, even though the first attempt
      // was a genuine provider failure.
      expect(result.answer).toBe(REFUSE_MESSAGE);
    });

    it('fails safe (never crashes) when the first attempt returns zero citations, retrying with the zero-citations correction (not the fabricated-chunkId message)', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'An answer with nothing backing it.',
        citations: [],
      });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      expect(result.insufficientEvidence).toBe(true);
      expect(result.confidence).toBe('low');
      expect(aiProvider.generateStructuredOutput).toHaveBeenCalledTimes(2);
      const retryCall = (aiProvider.generateStructuredOutput as jest.Mock).mock.calls[1][0];
      // The load-bearing assertion for this gap: the zero-citations case must not fall through
      // to `buildInvalidCitationCorrection` with an empty ID list (which would read "...do not
      // exist in the evidence above: ." -- a nonsensical prompt naming nothing).
      expect(retryCall.prompt).toContain('did not include any citations');
      expect(retryCall.prompt).not.toContain('do not exist in the evidence above');
    });

    it('retries with the zero-citations correction and succeeds when the retry actually includes a citation', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock)
        .mockResolvedValueOnce({
          answer: 'An answer with nothing backing it.',
          citations: [],
        })
        .mockResolvedValueOnce({
          answer: 'The corrected, grounded answer.',
          citations: [{ paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId: 'chunk-1' }],
        });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      expect(aiProvider.generateStructuredOutput).toHaveBeenCalledTimes(2);
      const retryCall = (aiProvider.generateStructuredOutput as jest.Mock).mock.calls[1][0];
      expect(retryCall.prompt).toContain(
        'You must cite at least one chunkId from the evidence above',
      );
      expect(result.confidence).toBe('high');
      expect(result.answer).toBe('The corrected, grounded answer.');
      // `retried` is never part of the public `Answer` response (see `libs/shared`'s
      // `AnswerSchema`) -- it's surfaced only via the request log. The other real branch into a
      // retry-success outcome (alongside the invalid-chunkId case covered in the "logging"
      // describe block below) must also log `retried: true`, not just get the answer/confidence
      // right.
      expect(logSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(parsed.retried).toBe(true);
    });

    // Finding: verifyCitations only proves a citation's chunkId was actually retrieved -- it
    // never checks whether the LLM's own paperNumber/paperTitle for that citation are the real
    // metadata for that chunk. A citation with a genuine chunkId but fabricated paperNumber/Title
    // must be corrected server-side from the actual retrieved chunk before it reaches the client,
    // never passed through as "verified" just because the chunkId matched.
    it('re-derives citation paperNumber/paperTitle from the actual retrieved chunk, never trusting the LLM\'s echoed values for those fields', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'Ambition must be made to counteract ambition.',
        citations: [
          {
            paperNumber: 999,
            paperTitle: 'A Completely Fabricated Title',
            chunkId: 'chunk-1',
            quotedPassage: 'Ambition must be made to counteract ambition.',
            relevanceExplanation: 'Directly answers the question.',
          },
        ],
      });
      const { service } = buildService(
        [
          fakeRow({
            chunkId: 'chunk-1',
            paperNumber: 51,
            paperTitle: 'The Structure of the Government',
            score: CONFIDENT_THRESHOLD,
          }),
        ],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      expect(result.citations).toEqual([
        {
          paperNumber: 51,
          paperTitle: 'The Structure of the Government',
          chunkId: 'chunk-1',
          quotedPassage: 'Ambition must be made to counteract ambition.',
          relevanceExplanation: 'Directly answers the question.',
        },
      ]);
    });

    it('re-derives citation paperNumber/paperTitle on the retry-success path too', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock)
        .mockResolvedValueOnce({
          answer: 'A fabricated answer.',
          citations: [{ paperNumber: 999, paperTitle: 'Not Real', chunkId: 'chunk-FABRICATED' }],
        })
        .mockResolvedValueOnce({
          answer: 'The corrected, grounded answer.',
          citations: [
            { paperNumber: 12345, paperTitle: 'Still Wrong Metadata', chunkId: 'chunk-1' },
          ],
        });
      const { service } = buildService(
        [
          fakeRow({
            chunkId: 'chunk-1',
            paperNumber: 51,
            paperTitle: 'The Structure of the Government',
            score: CONFIDENT_THRESHOLD,
          }),
        ],
        aiProvider,
      );

      const result = await service.ask('Why checks and balances?');

      expect(result.citations).toEqual([
        {
          paperNumber: 51,
          paperTitle: 'The Structure of the Government',
          chunkId: 'chunk-1',
        },
      ]);
    });
  });

  describe('clarify tier', () => {
    it('makes no LLM call and returns a best-guess response naming the top chunk\'s paper', async () => {
      const aiProvider = fakeAiProvider();
      const midpoint = (CONFIDENT_THRESHOLD + CLARIFY_THRESHOLD) / 2;
      const { service } = buildService(
        [
          fakeRow({
            chunkId: 'chunk-9',
            paperNumber: 39,
            paperTitle: 'The Conformity of the Plan to Republican Principles',
            score: midpoint,
          }),
        ],
        aiProvider,
      );

      const result = await service.ask('Some vague question');

      expect(aiProvider.generateStructuredOutput).not.toHaveBeenCalled();
      expect(result.confidence).toBe('low');
      expect(result.insufficientEvidence).toBe(true);
      expect(result.citations).toEqual([
        {
          paperNumber: 39,
          paperTitle: 'The Conformity of the Plan to Republican Principles',
          chunkId: 'chunk-9',
        },
      ]);
      expect(result.answer).toContain('39');
      // Deliberately no quotedPassage/relevanceExplanation -- an unproven guess, not a verified
      // source.
      expect(result.citations[0]).not.toHaveProperty('quotedPassage');
      expect(result.citations[0]).not.toHaveProperty('relevanceExplanation');
    });

    it('is exactly at the CLARIFY_THRESHOLD boundary (inclusive)', async () => {
      const aiProvider = fakeAiProvider();
      const { service } = buildService(
        [fakeRow({ score: CLARIFY_THRESHOLD })],
        aiProvider,
      );

      const result = await service.ask('question');

      expect(aiProvider.generateStructuredOutput).not.toHaveBeenCalled();
      expect(result.insufficientEvidence).toBe(true);
    });

    // 2026-09-03 second follow-up: this tier never runs at all once a current paper is present
    // -- ask() forces the confident tier instead, so the LLM gets a real chance at a grounded
    // answer rather than a templated guess. See the "forces the confident tier" describe block
    // below for that behavior; clarify tier itself is unchanged for the no-currentPaper case.
  });

  describe('refuse tier', () => {
    it('makes no LLM call and returns the blanket insufficient-evidence response with empty citations', async () => {
      const aiProvider = fakeAiProvider();
      const { service } = buildService(
        [fakeRow({ score: CLARIFY_THRESHOLD - 0.2 })],
        aiProvider,
      );

      const result = await service.ask('What is the best pizza topping?');

      expect(aiProvider.generateStructuredOutput).not.toHaveBeenCalled();
      expect(result).toEqual({
        answer: REFUSE_MESSAGE,
        citations: [],
        confidence: 'low',
        insufficientEvidence: true,
      });
    });

    it('refuses when retrieval returns zero chunks at all', async () => {
      const aiProvider = fakeAiProvider();
      const { service } = buildService([], aiProvider);

      const result = await service.ask('question');

      expect(aiProvider.generateStructuredOutput).not.toHaveBeenCalled();
      expect(result).toEqual({
        answer: REFUSE_MESSAGE,
        citations: [],
        confidence: 'low',
        insufficientEvidence: true,
      });
    });
  });

  // Story 5.2 (product-corrected 2026-09-02): `currentPaper` is prompt context for the LLM only
  // -- it must reach `buildAnswerPrompt`'s prompt text, and it must NOT reach
  // `retrieveRelevantChunks`'s SQL. The original version of this story threaded it into the
  // retrieval filter instead (reverted per the spec's Spec Change Log); the product owner
  // reconsidered because a hard filter made a genuinely cross-paper question unanswerable while
  // the chip was showing.
  describe('currentPaper prompt context (Story 5.2)', () => {
    it('includes the current paper as a contextual note in the prompt sent to the LLM', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'Ambition must be made to counteract ambition.',
        citations: [{ paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId: 'chunk-1' }],
      });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      await service.ask('Why checks and balances?', {
        paperNumber: 10,
        title: 'The Same Subject Continued',
      });

      const call = (aiProvider.generateStructuredOutput as jest.Mock).mock.calls[0][0];
      expect(call.prompt).toContain('Federalist No. 10');
      expect(call.prompt).toContain('The Same Subject Continued');
      // The note must read as context, not a restriction -- proving this isn't a regression back
      // toward "only answer from this paper."
      expect(call.prompt).toContain('context only');
    });

    it('omits any paper-context note from the prompt when currentPaper is absent', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'Ambition must be made to counteract ambition.',
        citations: [{ paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId: 'chunk-1' }],
      });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      await service.ask('Why checks and balances?');

      const call = (aiProvider.generateStructuredOutput as jest.Mock).mock.calls[0][0];
      expect(call.prompt).not.toContain('currently reading');
    });

    it('carries the paper-context note through to the one allowed retry prompt too', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock)
        .mockResolvedValueOnce({
          answer: 'A fabricated answer.',
          citations: [{ paperNumber: 999, paperTitle: 'Not Real', chunkId: 'chunk-FABRICATED' }],
        })
        .mockResolvedValueOnce({
          answer: 'The corrected, grounded answer.',
          citations: [{ paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId: 'chunk-1' }],
        });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      await service.ask('Why checks and balances?', {
        paperNumber: 10,
        title: 'The Same Subject Continued',
      });

      expect(aiProvider.generateStructuredOutput).toHaveBeenCalledTimes(2);
      const retryCall = (aiProvider.generateStructuredOutput as jest.Mock).mock.calls[1][0];
      expect(retryCall.prompt).toContain('Federalist No. 10');
    });

    it('never adds a paperNumber bound SQL parameter, even when currentPaper is provided', async () => {
      const aiProvider = fakeAiProvider();
      const { service, query } = buildService(
        [fakeRow({ chunkId: 'chunk-1', paperNumber: 51, score: CLARIFY_THRESHOLD - 0.2 })],
        aiProvider,
      );

      await service.ask('Why checks and balances?', {
        paperNumber: 51,
        title: 'The Structure of the Government',
      });

      expect(query).toHaveBeenCalledTimes(1);
      const [, params] = query.mock.calls[0];
      expect(params).not.toContain(51);
    });
  });

  // 2026-09-03 follow-up: a vague, low-signal question ("give me a TLDR") has nothing anchoring
  // it to the paper the user is actually reading now that the hard filter above is gone. Pinning
  // the current paper's own full content as extra evidence (no embedding call -- a plain lookup,
  // libs/retrieval's getAllChunksForPaper) closes that gap without reintroducing a filter.
  describe('pinning the current paper as extra evidence (2026-09-03)', () => {
    it('pins the current paper via a second, plain (non-embedding) lookup when it did not rank in the unrestricted results, and the LLM can cite it', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'A summary grounded in the pinned paper.',
        citations: [
          { paperNumber: 10, paperTitle: 'The Same Subject Continued', chunkId: 'pinned-chunk-1' },
        ],
      });
      const query = jest
        .fn()
        .mockResolvedValueOnce([
          fakeRow({ chunkId: 'unrelated-chunk', paperNumber: 51, score: CONFIDENT_THRESHOLD }),
        ])
        .mockResolvedValueOnce([
          {
            chunkId: 'pinned-chunk-1',
            paperNumber: 10,
            paperTitle: 'The Same Subject Continued',
            content: 'Pinned paper content.',
          },
        ]);
      const dataSource = { query } as unknown as DataSource;
      const service = new AskService(dataSource, aiProvider);

      const result = await service.ask('Can you give me a TLDR?', {
        paperNumber: 10,
        title: 'The Same Subject Continued',
      });

      expect(query).toHaveBeenCalledTimes(2);
      const [secondSql, secondParams] = query.mock.calls[1];
      expect(secondParams).toEqual([10]);
      expect(secondSql).not.toMatch(/embedding/i);

      const call = (aiProvider.generateStructuredOutput as jest.Mock).mock.calls[0][0];
      expect(call.prompt).toContain('pinned-chunk-1');
      expect(call.prompt).toContain('Pinned paper content.');
      // The pinned chunk was part of the real, verified evidence set -- citing it succeeds
      // rather than failing safe to a refuse-tier retry.
      expect(result.confidence).toBe('high');
      expect(result.citations).toEqual([
        { paperNumber: 10, paperTitle: 'The Same Subject Continued', chunkId: 'pinned-chunk-1' },
      ]);
    });

    // 2026-09-03 second follow-up: superseded the original version of this test (which asserted
    // the tier stayed 'clarify' and no LLM call happened). That's no longer this fix's goal --
    // see the "forces the confident tier" describe block below, which now covers exactly this
    // scenario (a low, sub-CLARIFY_THRESHOLD raw score, currentPaper present) and asserts the
    // LLM *is* called, grounded in the pinned chunk.

    it('does not attempt a second lookup when the current paper already appears in the unrestricted results', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'Answer.',
        citations: [{ paperNumber: 10, paperTitle: 'The Same Subject Continued', chunkId: 'chunk-1' }],
      });
      const { service, query } = buildService(
        [fakeRow({ chunkId: 'chunk-1', paperNumber: 10, score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      await service.ask('Why checks and balances?', {
        paperNumber: 10,
        title: 'The Same Subject Continued',
      });

      expect(query).toHaveBeenCalledTimes(1);
    });

    it('degrades gracefully (no thrown error) when the pinning lookup itself fails', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'Answer from the unrestricted results alone.',
        citations: [{ paperNumber: 51, paperTitle: 'The Structure of the Government', chunkId: 'chunk-1' }],
      });
      const query = jest
        .fn()
        .mockResolvedValueOnce([fakeRow({ chunkId: 'chunk-1', paperNumber: 51, score: CONFIDENT_THRESHOLD })])
        .mockRejectedValueOnce(new Error('pinning lookup failed'));
      const dataSource = { query } as unknown as DataSource;
      const service = new AskService(dataSource, aiProvider);

      const result = await service.ask('Can you give me a TLDR?', {
        paperNumber: 10,
        title: 'The Same Subject Continued',
      });

      expect(result.confidence).toBe('high');
      expect(result.citations).toEqual([
        { paperNumber: 51, paperTitle: 'The Structure of the Government', chunkId: 'chunk-1' },
      ]);
    });
  });

  // 2026-09-03 second follow-up: pinning alone (above) only fixes which evidence the LLM sees,
  // not whether it gets called at all -- a meta/summary-style question ("give me a TLDR")
  // structurally can't score well against decideAnswerTier's archive-wide content-similarity
  // gate no matter which paper is pinned. When the chip names a specific paper, that's itself a
  // stronger, deterministic signal than the raw score, so it overrides the gate entirely.
  describe('forces the confident tier when currentPaper is present (2026-09-03)', () => {
    it('calls the LLM (grounded in the pinned chunk) even though the raw archive-wide score alone would only reach the clarify tier', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'A real answer grounded in the pinned paper.',
        citations: [
          { paperNumber: 10, paperTitle: 'The Same Subject Continued', chunkId: 'pinned-chunk-1' },
        ],
      });
      const query = jest
        .fn()
        .mockResolvedValueOnce([
          fakeRow({ chunkId: 'clarify-chunk', paperNumber: 51, score: CLARIFY_THRESHOLD }),
        ])
        .mockResolvedValueOnce([
          {
            chunkId: 'pinned-chunk-1',
            paperNumber: 10,
            paperTitle: 'The Same Subject Continued',
            content: 'Pinned paper content.',
          },
        ]);
      const dataSource = { query } as unknown as DataSource;
      const service = new AskService(dataSource, aiProvider);

      const result = await service.ask('Can you give me a TLDR?', {
        paperNumber: 10,
        title: 'The Same Subject Continued',
      });

      expect(aiProvider.generateStructuredOutput).toHaveBeenCalledTimes(1);
      expect(result.confidence).toBe('high');
      expect(result.citations).toEqual([
        { paperNumber: 10, paperTitle: 'The Same Subject Continued', chunkId: 'pinned-chunk-1' },
      ]);
    });

    it('calls the LLM even when the raw archive-wide score would only reach the refuse tier', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'A real answer grounded in the pinned paper.',
        citations: [
          { paperNumber: 10, paperTitle: 'The Same Subject Continued', chunkId: 'pinned-chunk-1' },
        ],
      });
      const query = jest
        .fn()
        .mockResolvedValueOnce([
          fakeRow({ chunkId: 'refuse-chunk', paperNumber: 51, score: CLARIFY_THRESHOLD - 0.2 }),
        ])
        .mockResolvedValueOnce([
          {
            chunkId: 'pinned-chunk-1',
            paperNumber: 10,
            paperTitle: 'The Same Subject Continued',
            content: 'Pinned paper content.',
          },
        ]);
      const dataSource = { query } as unknown as DataSource;
      const service = new AskService(dataSource, aiProvider);

      const result = await service.ask('Yes', { paperNumber: 10, title: 'The Same Subject Continued' });

      expect(aiProvider.generateStructuredOutput).toHaveBeenCalledTimes(1);
      expect(result.confidence).toBe('high');
    });

    it('still fails safe to refuse if the forced LLM call cannot produce a verified citation -- the override never bypasses citation verification', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'A fabricated answer.',
        citations: [{ paperNumber: 999, paperTitle: 'Not Real', chunkId: 'chunk-FABRICATED' }],
      });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', paperNumber: 51, score: CLARIFY_THRESHOLD - 0.2 })],
        aiProvider,
      );

      const result = await service.ask('Yes', { paperNumber: 10, title: 'The Same Subject Continued' });

      expect(result.confidence).toBe('low');
      expect(result.insufficientEvidence).toBe(true);
      expect(result.citations).toEqual([]);
    });

    it('logs tierOverriddenByCurrentPaper: true only when the override actually changed the tier', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'Answer.',
        citations: [{ paperNumber: 10, paperTitle: 'The Same Subject Continued', chunkId: 'chunk-1' }],
      });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', paperNumber: 10, score: CLARIFY_THRESHOLD })],
        aiProvider,
      );

      await service.ask('Can you give me a TLDR?', {
        paperNumber: 10,
        title: 'The Same Subject Continued',
      });

      const parsed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(parsed.tier).toBe('confident');
      expect(parsed.tierOverriddenByCurrentPaper).toBe(true);
    });

    it('logs tierOverriddenByCurrentPaper: false when the raw score already reached confident on its own', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'Answer.',
        citations: [{ paperNumber: 10, paperTitle: 'The Same Subject Continued', chunkId: 'chunk-1' }],
      });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', paperNumber: 10, score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      await service.ask('Why checks and balances?', {
        paperNumber: 10,
        title: 'The Same Subject Continued',
      });

      const parsed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(parsed.tierOverriddenByCurrentPaper).toBe(false);
    });
  });

  describe('embedding/retrieval failure', () => {
    it('propagates the error (never a fabricated 200 answer, never a hang)', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateEmbedding as jest.Mock).mockRejectedValue(
        new Error('AI_PROVIDER is "gemini" but GEMINI_API_KEY is not set.'),
      );
      const { service } = buildService([], aiProvider);

      await expect(service.ask('question')).rejects.toThrow(/GEMINI_API_KEY/);
      expect(aiProvider.generateStructuredOutput).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('logs query, retrieved paper numbers, similarity scores, provider, and latency for every tier', async () => {
      const aiProvider = fakeAiProvider();
      const { service } = buildService(
        [fakeRow({ score: CLARIFY_THRESHOLD - 0.2, paperNumber: 12 })],
        aiProvider,
      );

      await service.ask('a refuse-tier question');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [line] = logSpy.mock.calls[0];
      const parsed = JSON.parse(line);
      expect(parsed.event).toBe('ask');
      expect(parsed.question).toBe('a refuse-tier question');
      expect(parsed.tier).toBe('refuse');
      expect(parsed.retrievedPaperNumbers).toEqual([12]);
      expect(Array.isArray(parsed.similarityScores)).toBe(true);
      expect(typeof parsed.provider).toBe('string');
      expect(typeof parsed.latencyMs).toBe('number');
    });

    it('logs an error-level entry (with the error message) when retrieval fails', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateEmbedding as jest.Mock).mockRejectedValue(new Error('boom'));
      const { service } = buildService([], aiProvider);

      await expect(service.ask('question')).rejects.toThrow('boom');

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(parsed.error).toBe('boom');
    });

    // Guards against a truthy check on `error` (`error ? 'error' : 'log'`): an Error whose
    // `.message` is the empty string is still a genuine error and must log at 'error' level, not
    // silently fall through to 'log' just because '' is falsy.
    it('logs at error level (not log level) when the error message is an empty string', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateEmbedding as jest.Mock).mockRejectedValue(new Error(''));
      const { service } = buildService([], aiProvider);

      await expect(service.ask('question')).rejects.toThrow();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).not.toHaveBeenCalled();
    });

    // Bonus finding: a successful retry used to be logged identically to a first-try success,
    // losing the signal of how often the model needs correcting. `retried` must be `true` only
    // when the confident tier's answer succeeded on its one allowed retry.
    it('logs retried: true only when a confident-tier answer succeeded on its retry, not on a first-try success', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock)
        .mockResolvedValueOnce({
          answer: 'A fabricated answer.',
          citations: [{ paperNumber: 999, paperTitle: 'Not Real', chunkId: 'chunk-FABRICATED' }],
        })
        .mockResolvedValueOnce({
          answer: 'The corrected, grounded answer.',
          citations: [{ paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId: 'chunk-1' }],
        });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      await service.ask('Why checks and balances?');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(parsed.retried).toBe(true);
    });

    it('logs retried: false for a confident-tier answer that succeeded on the first attempt', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'Ambition must be made to counteract ambition.',
        citations: [{ paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId: 'chunk-1' }],
      });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      await service.ask('Why checks and balances?');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(parsed.retried).toBe(false);
    });

    it('logs retried: false for the clarify tier (no LLM call at all, so no retry is possible)', async () => {
      const aiProvider = fakeAiProvider();
      const { service } = buildService(
        [fakeRow({ score: (CONFIDENT_THRESHOLD + CLARIFY_THRESHOLD) / 2 })],
        aiProvider,
      );

      await service.ask('Some vague question');

      expect(logSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(parsed.retried).toBe(false);
    });

    it('logs retried: false for a fail-safe-to-refuse outcome, even though a retry was attempted', async () => {
      const aiProvider = fakeAiProvider();
      (aiProvider.generateStructuredOutput as jest.Mock).mockResolvedValue({
        answer: 'Still fabricated.',
        citations: [{ paperNumber: 999, paperTitle: 'Not Real', chunkId: 'chunk-FABRICATED' }],
      });
      const { service } = buildService(
        [fakeRow({ chunkId: 'chunk-1', score: CONFIDENT_THRESHOLD })],
        aiProvider,
      );

      await service.ask('Why checks and balances?');

      // A fail-safe outcome carries an `error`, so `logRequest` logs at 'error' level, not 'log'.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(parsed.retried).toBe(false);
    });
  });
});
