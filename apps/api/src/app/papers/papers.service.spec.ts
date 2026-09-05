import type { EmbeddingProvider } from '@federalist-research/ai';
import { DataSource } from 'typeorm';
import { PapersService } from './papers.service';

/** None of findAll/search/findOne touch the EmbeddingProvider boundary at all -- a fake that's
 *  never expected to be called is enough to satisfy PapersService's constructor for those tests. */
function unusedAiProvider(): EmbeddingProvider {
  return { generateEmbedding: jest.fn() };
}

/**
 * Fakes only the DataSource boundary (no live Postgres) -- findAllPapersForBrowse itself is
 * exercised for real, against real Postgres, by
 * libs/database's paper-browse.repository.integration.spec.ts. This test covers the mapping
 * from that repository's row shape to the PaperSummary response contract.
 */
function createService(papers: unknown[]): PapersService {
  const dataSource = {
    getRepository: jest.fn().mockReturnValue({
      find: jest.fn().mockResolvedValue(papers),
    }),
  } as unknown as DataSource;
  return new PapersService(dataSource, unusedAiProvider());
}

/**
 * Fakes only the DataSource boundary -- findPaperDetailByNumber itself is exercised for real,
 * against real Postgres, by libs/database's paper-detail.repository.integration.spec.ts. This
 * test covers the mapping from that repository's row shape (or null) to the PaperDetail response
 * contract.
 */
function createServiceForDetail(row: unknown): PapersService {
  const dataSource = {
    getRepository: jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue(row),
    }),
  } as unknown as DataSource;
  return new PapersService(dataSource, unusedAiProvider());
}

/**
 * Fakes only the DataSource boundary -- searchPapers itself (the ILIKE/number-match query, real
 * joint-authorship joins, real dedup) is exercised for real, against real Postgres, by
 * libs/database's paper-search.repository.integration.spec.ts. This test covers only the mapping
 * from that repository's row shape to the PaperSummary response contract, same as findAll's.
 *
 * Callers exercise the plain-integer branch of the real (unmocked) searchPapers function --
 * repository.find is called directly with no join/ILIKE query needed -- so only `find` needs a
 * fake implementation here.
 */
function createServiceForSearch(rows: unknown[]): PapersService {
  const dataSource = {
    getRepository: jest.fn().mockReturnValue({
      find: jest.fn().mockResolvedValue(rows),
    }),
  } as unknown as DataSource;
  return new PapersService(dataSource, unusedAiProvider());
}

/**
 * Fakes both boundaries `retrieveRelevantChunks` composes -- `retrieveRelevantChunks` itself
 * (the raw pgvector SQL, filter-before-limit correctness) is exercised for real, against real
 * Postgres, by libs/retrieval's retrieval.integration.spec.ts. This test covers only that
 * PapersService.searchSemantic wires the DataSource/EmbeddingProvider/query/options through to it
 * untouched and returns its result as-is (Story 2.2's "pure pass-through" contract).
 */
function createServiceForSemantic(options: {
  embedding?: number[];
  rows?: unknown[];
}): { service: PapersService; aiProvider: EmbeddingProvider; query: jest.Mock } {
  const aiProvider: EmbeddingProvider = {
    generateEmbedding: jest.fn().mockResolvedValue(options.embedding ?? [0.1, 0.2, 0.3]),
  };
  const query = jest.fn().mockResolvedValue(options.rows ?? []);
  const dataSource = { query } as unknown as DataSource;
  return { service: new PapersService(dataSource, aiProvider), aiProvider, query };
}

describe('PapersService', () => {
  it('maps repository rows into the PaperSummary shape', async () => {
    const service = createService([
      { paperNumber: 1, title: 'General Introduction', authors: [{ name: 'Hamilton' }] },
    ]);

    await expect(service.findAll()).resolves.toEqual([
      { paperNumber: 1, title: 'General Introduction', authors: ['Hamilton'] },
    ]);
  });

  it('includes every credited author for a jointly-authored paper', async () => {
    const service = createService([
      {
        paperNumber: 18,
        title: 'The Utility of the Union as a Safeguard Against Domestic Faction and Insurrection',
        authors: [{ name: 'Hamilton' }, { name: 'Madison' }],
      },
    ]);

    const result = await service.findAll();

    expect(result[0].authors).toEqual(['Hamilton', 'Madison']);
  });

  it('returns an empty array when there are no papers', async () => {
    const service = createService([]);

    await expect(service.findAll()).resolves.toEqual([]);
  });

  describe('findOne', () => {
    it('maps a found repository row into the PaperDetail shape', async () => {
      const service = createServiceForDetail({
        paperNumber: 1,
        title: 'General Introduction',
        fullText: 'Paragraph one.\n\nParagraph two.',
        sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
        authors: [{ name: 'Hamilton' }],
      });

      await expect(service.findOne(1)).resolves.toEqual({
        paperNumber: 1,
        title: 'General Introduction',
        authors: ['Hamilton'],
        fullText: 'Paragraph one.\n\nParagraph two.',
        sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
      });
    });

    it('includes every credited author for a jointly-authored paper', async () => {
      const service = createServiceForDetail({
        paperNumber: 18,
        title: 'The Utility of the Union as a Safeguard Against Domestic Faction and Insurrection',
        fullText: 'Text.',
        sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed18.asp',
        authors: [{ name: 'Hamilton' }, { name: 'Madison' }],
      });

      const result = await service.findOne(18);

      expect(result?.authors).toEqual(['Hamilton', 'Madison']);
    });

    it('returns null when no paper with that number exists', async () => {
      const service = createServiceForDetail(null);

      await expect(service.findOne(999)).resolves.toBeNull();
    });
  });

  describe('search', () => {
    it('maps repository rows into the PaperSummary shape', async () => {
      const service = createServiceForSearch([
        { paperNumber: 51, title: 'The Structure of the Government', authors: [{ name: 'Hamilton' }] },
      ]);

      await expect(service.search('51')).resolves.toEqual([
        { paperNumber: 51, title: 'The Structure of the Government', authors: ['Hamilton'] },
      ]);
    });

    it('includes every credited author for a jointly-authored paper', async () => {
      const service = createServiceForSearch([
        {
          paperNumber: 18,
          title: 'The Utility of the Union as a Safeguard Against Domestic Faction and Insurrection',
          authors: [{ name: 'Hamilton' }, { name: 'Madison' }],
        },
      ]);

      const result = await service.search('18');

      expect(result[0].authors).toEqual(['Hamilton', 'Madison']);
    });

    it('returns an empty array when there are no matches', async () => {
      const service = createServiceForSearch([]);

      await expect(service.search('999999')).resolves.toEqual([]);
    });
  });

  describe('searchSemantic', () => {
    it('embeds the query, queries the DB, and maps the rows into RetrievedChunk[]', async () => {
      const { service, aiProvider, query } = createServiceForSemantic({
        rows: [
          {
            chunkId: 'chunk-1',
            paperNumber: 51,
            paperTitle: 'The Structure of the Government',
            content: 'Ambition must be made to counteract ambition.',
            score: 0.87,
          },
        ],
      });

      const result = await service.searchSemantic('how does government check itself', {
        topK: 5,
      });

      expect(aiProvider.generateEmbedding).toHaveBeenCalledWith(
        'how does government check itself',
      );
      expect(query).toHaveBeenCalled();
      expect(result).toEqual([
        {
          chunkId: 'chunk-1',
          paperNumber: 51,
          paperTitle: 'The Structure of the Government',
          content: 'Ambition must be made to counteract ambition.',
          score: 0.87,
        },
      ]);
    });

    it('returns an empty array for an empty query without calling the embedding model', async () => {
      const { service, aiProvider } = createServiceForSemantic({});

      await expect(service.searchSemantic('', {})).resolves.toEqual([]);
      expect(aiProvider.generateEmbedding).not.toHaveBeenCalled();
    });

    it('propagates an embedding-provider failure as a rejected promise, never swallowing it', async () => {
      const aiProvider: EmbeddingProvider = {
        generateEmbedding: jest.fn().mockRejectedValue(new Error('GEMINI_API_KEY is not set')),
      };
      const dataSource = { query: jest.fn() } as unknown as DataSource;
      const service = new PapersService(dataSource, aiProvider);

      await expect(service.searchSemantic('a query', {})).rejects.toThrow(
        /GEMINI_API_KEY/,
      );
    });
  });
});
