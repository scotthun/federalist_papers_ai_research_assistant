import type { RetrievedChunk } from '@federalist-research/retrieval';
import { runEval, withEmbedDelay, type EvalCase } from './eval-retrieval';
import evalDataset from './retrieval-eval-dataset.json';

function chunk(paperNumber: number, score = 0.9): RetrievedChunk {
  return {
    chunkId: `chunk-${paperNumber}`,
    paperNumber,
    paperTitle: `Paper ${paperNumber}`,
    content: 'Fixture content.',
    score,
  };
}

describe('runEval', () => {
  it('reports a hit when an expected paper appears among the retrieved papers', async () => {
    const cases: EvalCase[] = [{ question: 'about factions', expectedPapers: [10] }];
    const summary = await runEval({
      cases,
      retrieve: async () => [chunk(10), chunk(37)],
    });

    expect(summary.allPassed).toBe(true);
    expect(summary.results[0]).toMatchObject({
      question: 'about factions',
      expectedPapers: [10],
      retrievedPapers: [10, 37],
      hit: true,
    });
  });

  it('reports a miss, and allPassed false, when no expected paper is retrieved', async () => {
    const cases: EvalCase[] = [{ question: 'about factions', expectedPapers: [10] }];
    const summary = await runEval({
      cases,
      retrieve: async () => [chunk(37), chunk(38)],
    });

    expect(summary.allPassed).toBe(false);
    expect(summary.results[0].hit).toBe(false);
  });

  it('counts a hit for a multi-expected-paper case when any one of them is retrieved', async () => {
    const cases: EvalCase[] = [
      { question: 'single executive', expectedPapers: [67, 68, 69, 70, 71] },
    ];
    const summary = await runEval({
      cases,
      retrieve: async () => [chunk(70)],
    });

    expect(summary.allPassed).toBe(true);
    expect(summary.results[0].hit).toBe(true);
  });

  it('does not let one earlier miss short-circuit later cases', async () => {
    const cases: EvalCase[] = [
      { question: 'first (misses)', expectedPapers: [1] },
      { question: 'second (hits)', expectedPapers: [2] },
    ];
    const retrieve = jest.fn(async (question: string) =>
      question === 'first (misses)' ? [chunk(999)] : [chunk(2)],
    );

    const summary = await runEval({ cases, retrieve });

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(summary.allPassed).toBe(false);
    expect(summary.results.map((r) => r.hit)).toEqual([false, true]);
  });

  it('deduplicates retrievedPapers and rounds scores to 4 decimal places', async () => {
    const cases: EvalCase[] = [{ question: 'q', expectedPapers: [5] }];
    const summary = await runEval({
      cases,
      retrieve: async () => [
        chunk(5, 0.123456789),
        chunk(5, 0.111111),
        chunk(6, 0.05),
      ],
    });

    expect(summary.results[0].retrievedPapers).toEqual([5, 6]);
    expect(summary.results[0].scores).toEqual([0.1235, 0.1111, 0.05]);
  });

  it('invokes onResult for every case, in order', async () => {
    const cases: EvalCase[] = [
      { question: 'a', expectedPapers: [1] },
      { question: 'b', expectedPapers: [2] },
    ];
    const seen: string[] = [];

    await runEval({
      cases,
      retrieve: async () => [],
      onResult: (result) => seen.push(result.question),
    });

    expect(seen).toEqual(['a', 'b']);
  });

  it('reports allPassed true and an empty results array for an empty case list', async () => {
    const summary = await runEval({ cases: [], retrieve: jest.fn() });

    expect(summary).toEqual({ allPassed: true, results: [] });
  });

  it('catches a rejected retrieve() for one case, records it as a miss with the error captured, and still runs later cases', async () => {
    const cases: EvalCase[] = [
      { question: 'flaky (rejects)', expectedPapers: [1] },
      { question: 'later (succeeds)', expectedPapers: [2] },
    ];
    const retrieve = jest.fn(async (question: string) => {
      if (question === 'flaky (rejects)') {
        throw new Error('Gemini rate-limit blip: HTTP 429 RESOURCE_EXHAUSTED');
      }
      return [chunk(2)];
    });

    const summary = await runEval({ cases, retrieve });

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(summary.allPassed).toBe(false);
    expect(summary.results).toHaveLength(2);

    const [failed, succeeded] = summary.results;
    expect(failed).toMatchObject({
      question: 'flaky (rejects)',
      hit: false,
      retrievedPapers: [],
      error: 'Gemini rate-limit blip: HTTP 429 RESOURCE_EXHAUSTED',
    });
    expect(succeeded).toMatchObject({
      question: 'later (succeeds)',
      hit: true,
      retrievedPapers: [2],
    });
    expect(succeeded.error).toBeUndefined();
  });

  it('still invokes onResult for a case whose retrieve() rejected', async () => {
    const cases: EvalCase[] = [{ question: 'flaky', expectedPapers: [1] }];
    const seen: EvalCase['question'][] = [];

    await runEval({
      cases,
      retrieve: async () => {
        throw new Error('boom');
      },
      onResult: (result) => seen.push(result.question),
    });

    expect(seen).toEqual(['flaky']);
  });
});

describe('withEmbedDelay', () => {
  it('does not delay before the first call', async () => {
    const sleepFn = jest.fn().mockResolvedValue(undefined);
    const retrieve = jest.fn(async () => [] as RetrievedChunk[]);
    const delayed = withEmbedDelay(retrieve, 250, sleepFn);

    await delayed('first question');

    expect(sleepFn).not.toHaveBeenCalled();
    expect(retrieve).toHaveBeenCalledWith('first question');
  });

  it('awaits the configured delay before every call after the first', async () => {
    const sleepFn = jest.fn().mockResolvedValue(undefined);
    const retrieve = jest.fn(async () => [] as RetrievedChunk[]);
    const delayed = withEmbedDelay(retrieve, 250, sleepFn);

    await delayed('first question');
    await delayed('second question');
    await delayed('third question');

    expect(sleepFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenNthCalledWith(1, 250);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 250);
  });
});

/**
 * Sanity coverage for the hand-built dataset itself (this story's Tasks: "at least 6 cases,
 * including one multi-expected-paper case") -- catches an accidental shape regression (e.g. an
 * empty question, an empty expectedPapers array) without needing a real DB/API run.
 */
describe('retrieval-eval-dataset.json', () => {
  it('has at least 6 cases', () => {
    expect(evalDataset.length).toBeGreaterThanOrEqual(6);
  });

  it('gives every case a non-empty question and at least one positive-integer expected paper', () => {
    for (const testCase of evalDataset) {
      expect(typeof testCase.question).toBe('string');
      expect(testCase.question.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(testCase.expectedPapers)).toBe(true);
      expect(testCase.expectedPapers.length).toBeGreaterThan(0);
      for (const paperNumber of testCase.expectedPapers) {
        expect(Number.isInteger(paperNumber)).toBe(true);
        expect(paperNumber).toBeGreaterThan(0);
      }
    }
  });

  it('includes at least one multi-expected-paper case (e.g. the single-executive papers)', () => {
    expect(evalDataset.some((testCase) => testCase.expectedPapers.length > 1)).toBe(true);
  });
});
