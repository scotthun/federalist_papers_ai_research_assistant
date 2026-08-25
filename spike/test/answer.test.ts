import { describe, it, expect, vi } from 'vitest';
import { answerWithVerification } from '../src/answer.js';
import type { RetrievedChunk } from '../src/db.js';

const context: RetrievedChunk[] = [
  { chunkId: 5, paperId: 1, paperNumber: 51, paperTitle: 'Test', sourceUrl: 'x', content: 'real content', score: 0.9 },
];

describe('answerWithVerification (retry-then-fail-safe policy)', () => {
  it('returns the answer directly when the first attempt cites a real chunk', async () => {
    const generate = vi.fn().mockResolvedValue({
      answer: 'Good answer',
      citations: [{ chunkId: 5, paperNumber: 51, quotedPassage: 'real content' }],
    });
    const result = await answerWithVerification('q', context, generate);
    expect(result.insufficientEvidence).toBe(false);
    expect(result.answer).toBe('Good answer');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retries once with a correction when the first attempt fabricates a chunkId, then succeeds', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        answer: 'Bad answer',
        citations: [{ chunkId: 999, paperNumber: 51, quotedPassage: 'made up' }],
      })
      .mockResolvedValueOnce({
        answer: 'Corrected answer',
        citations: [{ chunkId: 5, paperNumber: 51, quotedPassage: 'real content' }],
      });

    const result = await answerWithVerification('q', context, generate);

    expect(generate).toHaveBeenCalledTimes(2);
    // the retry call must tell the model which id was invalid and what the valid set is
    const retryContext = generate.mock.calls[1][1] as { content: string }[];
    const correctionText = retryContext.map((c) => c.content).join(' ');
    expect(correctionText).toContain('999');
    expect(correctionText).toContain('5');
    expect(result.insufficientEvidence).toBe(false);
    expect(result.answer).toBe('Corrected answer');
  });

  it('fails safe to insufficientEvidence if the retry ALSO fabricates a chunkId -- never strips the bad citation and serves the rest', async () => {
    const generate = vi.fn().mockResolvedValue({
      answer: 'Still bad',
      citations: [{ chunkId: 999, paperNumber: 51, quotedPassage: 'still made up' }],
    });

    const result = await answerWithVerification('q', context, generate);

    expect(generate).toHaveBeenCalledTimes(2); // one original + one retry, then stop
    expect(result.insufficientEvidence).toBe(true);
    expect(result.answer).not.toBe('Still bad');
    expect(result.citations).toEqual([]);
  });
});
