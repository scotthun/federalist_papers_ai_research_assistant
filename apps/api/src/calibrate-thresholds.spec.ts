import type { RetrievedChunk } from '@federalist-research/retrieval';
import { runCalibration, withEmbedDelay, type CalibrationCase } from './calibrate-thresholds';

function chunk(score: number): RetrievedChunk {
  return {
    chunkId: 'chunk-1',
    paperNumber: 51,
    paperTitle: 'Paper 51',
    content: 'Fixture content.',
    score,
  };
}

describe('runCalibration', () => {
  it('records the top score and full score list per on-topic and off-topic case', async () => {
    const onTopicCases: CalibrationCase[] = [{ question: 'on-topic question' }];
    const offTopicCases: CalibrationCase[] = [{ question: 'off-topic question' }];
    const retrieve = jest.fn(async (question: string) =>
      question === 'on-topic question' ? [chunk(0.75), chunk(0.6)] : [chunk(0.1)],
    );

    const summary = await runCalibration({ onTopicCases, offTopicCases, retrieve });

    expect(summary.results).toEqual([
      { group: 'on-topic', question: 'on-topic question', topScore: 0.75, scores: [0.75, 0.6] },
      { group: 'off-topic', question: 'off-topic question', topScore: 0.1, scores: [0.1] },
    ]);
  });

  it('computes min/max/avg summaries separately for each group', async () => {
    const onTopicCases: CalibrationCase[] = [{ question: 'a' }, { question: 'b' }];
    const offTopicCases: CalibrationCase[] = [{ question: 'c' }, { question: 'd' }];
    const retrieve = jest.fn(async (question: string) => {
      const topScores: Record<string, number> = { a: 0.8, b: 0.6, c: 0.2, d: 0.0 };
      return [chunk(topScores[question])];
    });

    const summary = await runCalibration({ onTopicCases, offTopicCases, retrieve });

    expect(summary.onTopicTopScores).toEqual({ min: 0.6, max: 0.8, avg: 0.7 });
    expect(summary.offTopicTopScores).toEqual({ min: 0, max: 0.2, avg: 0.1 });
  });

  it('leaves topScore undefined and records the error when retrieve rejects, without aborting later cases', async () => {
    const onTopicCases: CalibrationCase[] = [{ question: 'flaky' }, { question: 'fine' }];
    const retrieve = jest.fn(async (question: string) => {
      if (question === 'flaky') throw new Error('rate limit blip');
      return [chunk(0.5)];
    });

    const summary = await runCalibration({ onTopicCases, offTopicCases: [], retrieve });

    expect(summary.results[0]).toEqual({
      group: 'on-topic',
      question: 'flaky',
      scores: [],
      error: 'rate limit blip',
    });
    expect(summary.results[1]).toMatchObject({ question: 'fine', topScore: 0.5 });
  });

  it('treats zero retrieved chunks as topScore undefined, excluded from the summary', async () => {
    const onTopicCases: CalibrationCase[] = [{ question: 'empty' }];
    const retrieve = jest.fn(async () => [] as RetrievedChunk[]);

    const summary = await runCalibration({ onTopicCases, offTopicCases: [], retrieve });

    expect(summary.results[0].topScore).toBeUndefined();
    expect(summary.onTopicTopScores).toBeUndefined();
  });

  it('returns undefined summaries (not a crash) for an empty case list', async () => {
    const summary = await runCalibration({
      onTopicCases: [],
      offTopicCases: [],
      retrieve: jest.fn(),
    });

    expect(summary).toEqual({
      results: [],
      onTopicTopScores: undefined,
      offTopicTopScores: undefined,
    });
  });

  it('invokes onResult for every case, in group order', async () => {
    const seen: string[] = [];
    await runCalibration({
      onTopicCases: [{ question: 'a' }],
      offTopicCases: [{ question: 'b' }],
      retrieve: async () => [chunk(0.5)],
      onResult: (result) => seen.push(`${result.group}:${result.question}`),
    });

    expect(seen).toEqual(['on-topic:a', 'off-topic:b']);
  });
});

describe('withEmbedDelay', () => {
  it('does not delay before the first call, and delays every call after it', async () => {
    const sleepFn = jest.fn().mockResolvedValue(undefined);
    const retrieve = jest.fn(async () => [] as RetrievedChunk[]);
    const delayed = withEmbedDelay(retrieve, 250, sleepFn);

    await delayed('first');
    await delayed('second');

    expect(sleepFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).toHaveBeenCalledWith(250);
  });
});
