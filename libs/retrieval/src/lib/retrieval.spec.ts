import type { AIProvider } from '@federalist-research/ai';
import { DataSource } from 'typeorm';
import { getAllChunksForPaper, retrieveRelevantChunks } from './retrieval';

/**
 * Pure-JS unit coverage for `retrieveRelevantChunks`'s composition logic (embedding call,
 * default/short-circuit behavior, SQL/param construction, row-to-RetrievedChunk mapping) --
 * fakes both boundaries (`AIProvider` and `DataSource`), no real Postgres or Gemini call. The
 * real pgvector SQL correctness this function's Boundaries actually hinge on (ordering,
 * filter-before-limit against real data) is covered separately by
 * retrieval.integration.spec.ts, which is DATABASE_URL-gated and runs against real Postgres +
 * hand-crafted deterministic embeddings -- never a real Gemini call either.
 */
function fakeAiProvider(embedding: number[] = [0.1, 0.2, 0.3]): AIProvider {
  return {
    generateEmbedding: jest.fn().mockResolvedValue(embedding),
    generateStructuredOutput: jest.fn(),
  };
}

function fakeDataSource(rows: unknown[] = []): { dataSource: DataSource; query: jest.Mock } {
  const query = jest.fn().mockResolvedValue(rows);
  const dataSource = { query } as unknown as DataSource;
  return { dataSource, query };
}

describe('retrieveRelevantChunks', () => {
  it('returns an empty array for an empty query without calling the embedding model or the DB', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource, query } = fakeDataSource();

    await expect(retrieveRelevantChunks(dataSource, aiProvider, '')).resolves.toEqual([]);
    expect(aiProvider.generateEmbedding).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('returns an empty array for a whitespace-only query without calling the embedding model or the DB', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource, query } = fakeDataSource();

    await expect(retrieveRelevantChunks(dataSource, aiProvider, '   ')).resolves.toEqual([]);
    expect(aiProvider.generateEmbedding).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('embeds the trimmed query via aiProvider.generateEmbedding', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource } = fakeDataSource();

    await retrieveRelevantChunks(dataSource, aiProvider, '  how does government check itself  ');

    expect(aiProvider.generateEmbedding).toHaveBeenCalledWith(
      'how does government check itself',
    );
  });

  it('maps DB rows into RetrievedChunk objects, converting score to a number', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource } = fakeDataSource([
      {
        chunkId: 'chunk-1',
        paperNumber: 51,
        paperTitle: 'The Structure of the Government',
        content: 'Ambition must be made to counteract ambition.',
        score: '0.8731', // Postgres can return a numeric-looking value as a string
      },
    ]);

    const result = await retrieveRelevantChunks(dataSource, aiProvider, 'checks and balances');

    expect(result).toEqual([
      {
        chunkId: 'chunk-1',
        paperNumber: 51,
        paperTitle: 'The Structure of the Government',
        content: 'Ambition must be made to counteract ambition.',
        score: 0.8731,
      },
    ]);
  });

  it('defaults topK to 5 when options.topK is omitted', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource, query } = fakeDataSource();

    await retrieveRelevantChunks(dataSource, aiProvider, 'factions');

    const [, params] = query.mock.calls[0];
    expect(params[params.length - 1]).toBe(5);
  });

  it('passes a provided topK through as the LIMIT param', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource, query } = fakeDataSource();

    await retrieveRelevantChunks(dataSource, aiProvider, 'factions', { topK: 12 });

    const [, params] = query.mock.calls[0];
    expect(params[params.length - 1]).toBe(12);
  });

  it('applies no paperNumber/author WHERE filtering when neither option is provided', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource, query } = fakeDataSource();

    await retrieveRelevantChunks(dataSource, aiProvider, 'factions');

    const [sql] = query.mock.calls[0];
    expect(sql).not.toMatch(/paper_number =/);
    expect(sql).not.toMatch(/ILIKE/);
  });

  it('adds a paper_number WHERE filter, with the filter value bound as its own param', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource, query } = fakeDataSource();

    await retrieveRelevantChunks(dataSource, aiProvider, 'executive power', {
      paperNumber: 70,
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/paper_number = \$2/);
    expect(params).toEqual(['[0.1,0.2,0.3]', 70, 5]);
  });

  it('adds an author EXISTS filter against the join table, wrapped and escaped like Story 2.1', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource, query } = fakeDataSource();

    await retrieveRelevantChunks(dataSource, aiProvider, 'union', { author: 'Madison' });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/federalist_paper_authors/);
    expect(sql).toMatch(/ILIKE \$2/);
    expect(params).toEqual(['[0.1,0.2,0.3]', '%Madison%', 5]);
  });

  it('treats a blank/whitespace-only author option as no filter at all', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource, query } = fakeDataSource();

    await retrieveRelevantChunks(dataSource, aiProvider, 'union', { author: '   ' });

    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/ILIKE/);
    expect(params).toEqual(['[0.1,0.2,0.3]', 5]);
  });

  it('combines paperNumber and author filters, both bound before the topK LIMIT param', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource, query } = fakeDataSource();

    await retrieveRelevantChunks(dataSource, aiProvider, 'union', {
      paperNumber: 18,
      author: 'Madison',
      topK: 3,
    });

    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['[0.1,0.2,0.3]', 18, '%Madison%', 3]);
  });

  it('adds chunk.id as a deterministic secondary ORDER BY key alongside the primary similarity expression, without altering that primary expression', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource, query } = fakeDataSource();

    await retrieveRelevantChunks(dataSource, aiProvider, 'factions');

    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY chunk\.embedding::halfvec\(3072\) <=> \$1, chunk\.id\s/);
  });

  it('passes through a negative score unchanged -- score is 1 - cosine_distance, not a value clamped to [0, 1]', async () => {
    const aiProvider = fakeAiProvider();
    const { dataSource } = fakeDataSource([
      {
        chunkId: 'chunk-2',
        paperNumber: 12,
        paperTitle: 'Some Paper',
        content: 'Anti-correlated content.',
        score: '-0.42', // Postgres can return a numeric-looking value as a string
      },
    ]);

    const result = await retrieveRelevantChunks(dataSource, aiProvider, 'query');

    expect(result[0].score).toBe(-0.42);
  });
});

describe('getAllChunksForPaper', () => {
  it('returns every row for the given paperNumber without embedding anything or needing an AIProvider', async () => {
    const { dataSource, query } = fakeDataSource([
      { chunkId: 'chunk-1', paperNumber: 51, paperTitle: 'Federalist No. 51', content: 'First.' },
      { chunkId: 'chunk-2', paperNumber: 51, paperTitle: 'Federalist No. 51', content: 'Second.' },
    ]);

    const result = await getAllChunksForPaper(dataSource, 51);

    expect(result).toEqual([
      { chunkId: 'chunk-1', paperNumber: 51, paperTitle: 'Federalist No. 51', content: 'First.', score: 1 },
      { chunkId: 'chunk-2', paperNumber: 51, paperTitle: 'Federalist No. 51', content: 'Second.', score: 1 },
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([51]);
    expect(sql).toMatch(/WHERE paper\.paper_number = \$1/);
    expect(sql).toMatch(/ORDER BY chunk\.chunk_index/);
    expect(sql).not.toMatch(/embedding/i);
  });

  it('returns an empty array when the paper has no chunks', async () => {
    const { dataSource } = fakeDataSource([]);

    await expect(getAllChunksForPaper(dataSource, 999)).resolves.toEqual([]);
  });
});
