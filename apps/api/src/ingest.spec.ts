import {
  errorMessage,
  loadIngestConfig,
  runIngestion,
  shouldExitWithError,
  type IngestPaperResult,
} from './ingest';

describe('runIngestion', () => {
  const noopSleep = () => Promise.resolve();

  it('continues past a single paper failure rather than aborting the run', async () => {
    const attempted: number[] = [];
    const ingestOnePaper = jest.fn(
      async (paperNumber: number): Promise<IngestPaperResult> => {
        attempted.push(paperNumber);
        if (paperNumber === 2) {
          throw new Error('boom');
        }
        return { chunkCount: 1, authors: ['Hamilton'] };
      },
    );

    const summary = await runIngestion({
      paperNumbers: [1, 2, 3],
      fetchDelayMs: 0,
      ingestOnePaper,
      sleepFn: noopSleep,
    });

    expect(attempted).toEqual([1, 2, 3]);
    expect(summary).toEqual({ succeeded: 2, failed: 1 });
  });

  it('reports every paper as failed when every call rejects', async () => {
    const summary = await runIngestion({
      paperNumbers: [1, 2, 3],
      fetchDelayMs: 0,
      ingestOnePaper: async () => {
        throw new Error('always fails');
      },
      sleepFn: noopSleep,
    });

    expect(summary).toEqual({ succeeded: 0, failed: 3 });
  });

  it('reports zero succeeded and zero failed for an empty paper-number list', async () => {
    const summary = await runIngestion({
      paperNumbers: [],
      fetchDelayMs: 0,
      ingestOnePaper: jest.fn(),
      sleepFn: noopSleep,
    });

    expect(summary).toEqual({ succeeded: 0, failed: 0 });
  });

  it('invokes onSuccess/onFailure with the right paper numbers and never re-throws', async () => {
    const successes: number[] = [];
    const failures: number[] = [];

    await runIngestion({
      paperNumbers: [10, 11],
      fetchDelayMs: 0,
      ingestOnePaper: async (paperNumber) => {
        if (paperNumber === 11) throw new Error('nope');
        return { chunkCount: 2, authors: ['Jay'] };
      },
      onSuccess: (paperNumber) => successes.push(paperNumber),
      onFailure: (paperNumber) => failures.push(paperNumber),
      sleepFn: noopSleep,
    });

    expect(successes).toEqual([10]);
    expect(failures).toEqual([11]);
  });

  it('sleeps between papers but not after the last one', async () => {
    const sleepCalls: number[] = [];
    await runIngestion({
      paperNumbers: [1, 2, 3],
      fetchDelayMs: 250,
      ingestOnePaper: async () => ({ chunkCount: 1, authors: [] }),
      sleepFn: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    expect(sleepCalls).toEqual([250, 250]);
  });
});

describe('shouldExitWithError', () => {
  it('is true when zero papers succeeded, regardless of how many failed', () => {
    expect(shouldExitWithError({ succeeded: 0, failed: 5 })).toBe(true);
    expect(shouldExitWithError({ succeeded: 0, failed: 0 })).toBe(true);
  });

  it('is false when at least one paper succeeded', () => {
    expect(shouldExitWithError({ succeeded: 1, failed: 84 })).toBe(false);
    expect(shouldExitWithError({ succeeded: 85, failed: 0 })).toBe(false);
  });
});

describe('loadIngestConfig', () => {
  it('applies documented defaults when no env vars are set', () => {
    const config = loadIngestConfig({});
    expect(config.firstPaperNumber).toBe(1);
    expect(config.lastPaperNumber).toBe(85);
    expect(config.fetchDelayMs).toBe(500);
    expect(config.embedDelayMs).toBe(250);
    expect(config.chunkOptions).toEqual({
      targetWords: 750,
      maxWords: 1000,
      overlapWords: 100,
    });
  });

  it('reads overrides from the env', () => {
    const config = loadIngestConfig({
      INGEST_FIRST_PAPER: '10',
      INGEST_LAST_PAPER: '20',
      INGEST_FETCH_DELAY_MS: '1000',
      INGEST_EMBED_DELAY_MS: '2000',
      INGEST_CHUNK_TARGET_WORDS: '600',
      INGEST_CHUNK_MAX_WORDS: '800',
      INGEST_CHUNK_OVERLAP_WORDS: '50',
    });
    expect(config.firstPaperNumber).toBe(10);
    expect(config.lastPaperNumber).toBe(20);
    expect(config.fetchDelayMs).toBe(1000);
    expect(config.embedDelayMs).toBe(2000);
    expect(config.chunkOptions).toEqual({
      targetWords: 600,
      maxWords: 800,
      overlapWords: 50,
    });
  });

  it('throws instead of silently producing NaN for a non-numeric range value', () => {
    expect(() =>
      loadIngestConfig({ INGEST_FIRST_PAPER: 'not-a-number' }),
    ).toThrow(/INGEST_FIRST_PAPER/);
  });

  it('throws instead of silently producing NaN for a non-numeric delay value', () => {
    expect(() =>
      loadIngestConfig({ INGEST_FETCH_DELAY_MS: 'not-a-number' }),
    ).toThrow(/INGEST_FETCH_DELAY_MS/);
  });

  it('throws a clear error when the range is inverted (first > last)', () => {
    expect(() =>
      loadIngestConfig({ INGEST_FIRST_PAPER: '50', INGEST_LAST_PAPER: '10' }),
    ).toThrow(/INGEST_FIRST_PAPER.*INGEST_LAST_PAPER/);
  });

  it('throws a clear error for a negative delay', () => {
    expect(() => loadIngestConfig({ INGEST_EMBED_DELAY_MS: '-1' })).toThrow(
      /non-negative/,
    );
  });
});

describe('errorMessage', () => {
  it('extracts the message from an Error instance', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies a non-Error throw rather than logging "undefined"', () => {
    expect(errorMessage('a plain string rejection')).toBe(
      'a plain string rejection',
    );
    expect(errorMessage({ code: 429 })).toBe('[object Object]');
  });
});
