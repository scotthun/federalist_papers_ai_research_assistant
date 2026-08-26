import { DataSource } from 'typeorm';
import { searchPapers } from './paper-search.repository';

/**
 * Pure-JS unit coverage for searchPapers's branching (number vs. keyword path), its final
 * author-name/paperNumber sort, and its empty-query short-circuit -- no Postgres required. The
 * DB-backed correctness of the underlying queries (real ILIKE matching, real joint-authorship
 * joins, real dedup) is covered separately by paper-search.repository.integration.spec.ts, which
 * is DATABASE_URL-gated and skipped by the default `nx run-many -t test`, same layering as
 * paper-browse.repository.spec.ts / paper-detail.repository.spec.ts.
 */
function fakeQueryBuilder(rawMatches: Array<{ id: string }>) {
  const queryBuilder = {
    leftJoin: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    distinct: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rawMatches),
  };
  return queryBuilder;
}

function fakeDataSource(options: {
  findResult?: unknown[];
  rawMatches?: Array<{ id: string }>;
}): { dataSource: DataSource; repository: ReturnType<typeof createRepositoryMock> } {
  const repository = createRepositoryMock(
    options.findResult ?? [],
    options.rawMatches ?? [],
  );
  const dataSource = {
    getRepository: jest.fn().mockReturnValue(repository),
  } as unknown as DataSource;
  return { dataSource, repository };
}

function createRepositoryMock(findResult: unknown[], rawMatches: Array<{ id: string }>) {
  return {
    find: jest.fn().mockResolvedValue(findResult),
    createQueryBuilder: jest.fn().mockReturnValue(fakeQueryBuilder(rawMatches)),
  };
}

describe('searchPapers', () => {
  it('returns an empty array for an empty query without touching the DataSource', async () => {
    const { dataSource, repository } = fakeDataSource({});

    await expect(searchPapers(dataSource, '')).resolves.toEqual([]);
    expect((dataSource.getRepository as jest.Mock)).not.toHaveBeenCalled();
    expect(repository.find).not.toHaveBeenCalled();
  });

  it('returns an empty array for a whitespace-only query without touching the DataSource', async () => {
    const { dataSource } = fakeDataSource({});

    await expect(searchPapers(dataSource, '   ')).resolves.toEqual([]);
    expect((dataSource.getRepository as jest.Mock)).not.toHaveBeenCalled();
  });

  describe('when the query is a plain decimal integer', () => {
    it('queries by exact paperNumber, bypassing the keyword path entirely', async () => {
      const { dataSource, repository } = fakeDataSource({
        findResult: [
          { paperNumber: 51, title: 'The Structure of the Government', authors: [{ name: 'Hamilton' }] },
        ],
      });

      const result = await searchPapers(dataSource, '51');

      expect(repository.find).toHaveBeenCalledWith({
        where: { paperNumber: 51 },
        relations: { authors: true },
      });
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
      expect(result).toEqual([
        { paperNumber: 51, title: 'The Structure of the Government', authorNames: ['Hamilton'] },
      ]);
    });

    it('trims surrounding whitespace before checking for a plain integer', async () => {
      const { dataSource, repository } = fakeDataSource({
        findResult: [{ paperNumber: 1, title: 'General Introduction', authors: [] }],
      });

      await searchPapers(dataSource, '  1  ');

      expect(repository.find).toHaveBeenCalledWith({
        where: { paperNumber: 1 },
        relations: { authors: true },
      });
    });

    // Number()-lenient lookalikes (parsePaperNumberRouteSegment's own concern, exhaustively
    // covered in libs/shared) must fall through to the keyword path here, not the number path.
    it('treats a Number()-lenient lookalike (e.g. "1.0") as a keyword, not a paper number', async () => {
      const { dataSource, repository } = fakeDataSource({ rawMatches: [] });

      await searchPapers(dataSource, '1.0');

      expect(repository.createQueryBuilder).toHaveBeenCalled();
      expect(repository.find).not.toHaveBeenCalled();
    });
  });

  describe('when the query is a keyword', () => {
    it('queries title, full text, and author name via a case-insensitive substring match', async () => {
      const { dataSource, repository } = fakeDataSource({
        rawMatches: [{ id: 'paper-a' }],
        findResult: [{ paperNumber: 18, title: 'Joint Paper', authors: [{ name: 'Madison' }] }],
      });

      await searchPapers(dataSource, 'Madison');

      const queryBuilder = repository.createQueryBuilder.mock.results[0].value;
      expect(repository.createQueryBuilder).toHaveBeenCalledWith('paper');
      expect(queryBuilder.leftJoin).toHaveBeenCalledWith('paper.authors', 'author');
      expect(queryBuilder.distinct).toHaveBeenCalledWith(true);
      expect(queryBuilder.where).toHaveBeenCalledWith('paper.title ILIKE :likeTerm', {
        likeTerm: '%Madison%',
      });
      expect(queryBuilder.orWhere).toHaveBeenCalledWith('paper.fullText ILIKE :likeTerm', {
        likeTerm: '%Madison%',
      });
      expect(queryBuilder.orWhere).toHaveBeenCalledWith('author.name ILIKE :likeTerm', {
        likeTerm: '%Madison%',
      });
    });

    // Postgres's ILIKE treats %, _, and \ as pattern metacharacters -- a term containing one of
    // these (e.g. a user literally typing "50% off") must be matched literally, not have that
    // character reinterpreted as a wildcard (this story's "case-insensitive substring" contract).
    it('escapes ILIKE wildcard characters (%, _, and a literal backslash) in the search term', async () => {
      const { dataSource, repository } = fakeDataSource({ rawMatches: [] });

      await searchPapers(dataSource, 'weird%_\\term');

      const queryBuilder = repository.createQueryBuilder.mock.results[0].value;
      expect(queryBuilder.where).toHaveBeenCalledWith('paper.title ILIKE :likeTerm', {
        likeTerm: '%weird\\%\\_\\\\term%',
      });
      expect(queryBuilder.orWhere).toHaveBeenCalledWith('paper.fullText ILIKE :likeTerm', {
        likeTerm: '%weird\\%\\_\\\\term%',
      });
    });

    it('re-fetches matched papers by id with the full authors relation loaded', async () => {
      const { dataSource, repository } = fakeDataSource({
        rawMatches: [{ id: 'paper-a' }, { id: 'paper-b' }],
        findResult: [],
      });

      await searchPapers(dataSource, 'faction');

      expect(repository.find).toHaveBeenCalledWith({
        where: { id: expect.anything() },
        relations: { authors: true },
      });
    });

    it('returns an empty array, without a second query, when nothing matches', async () => {
      const { dataSource, repository } = fakeDataSource({ rawMatches: [] });

      await expect(searchPapers(dataSource, 'zzznonsensezzz')).resolves.toEqual([]);
      expect(repository.find).not.toHaveBeenCalled();
    });

    it("sorts each matched paper's authors alphabetically, regardless of query order", async () => {
      const { dataSource } = fakeDataSource({
        rawMatches: [{ id: 'paper-a' }],
        findResult: [
          {
            paperNumber: 18,
            title: 'Jointly Authored Test Paper',
            authors: [{ name: 'Madison' }, { name: 'Hamilton' }],
          },
        ],
      });

      const result = await searchPapers(dataSource, 'Hamilton');

      expect(result[0].authorNames).toEqual(['Hamilton', 'Madison']);
    });

    it('sorts results by paperNumber ascending, regardless of the order the DB returns them in', async () => {
      const { dataSource } = fakeDataSource({
        rawMatches: [{ id: 'paper-a' }, { id: 'paper-b' }],
        findResult: [
          { paperNumber: 63, title: 'Later Paper', authors: [] },
          { paperNumber: 18, title: 'Earlier Paper', authors: [] },
        ],
      });

      const result = await searchPapers(dataSource, 'paper');

      expect(result.map((row) => row.paperNumber)).toEqual([18, 63]);
    });
  });
});
