import { DataSource } from 'typeorm';
import { findAllPapersForBrowse } from './paper-browse.repository';

/**
 * Pure-JS unit coverage for findAllPapersForBrowse's author-name sort -- no Postgres required.
 * The DB-backed correctness of the underlying query (real ordering, real join) is covered
 * separately by paper-browse.repository.integration.spec.ts, which is DATABASE_URL-gated and
 * skipped by the default `nx run-many -t test`. This test exists so the `.sort()` call itself
 * (pure JS behavior) is exercised by a test that would actually fail if it were deleted --
 * feeding names that are already alphabetical wouldn't do that.
 */
function fakeDataSourceWith(rows: unknown[]): DataSource {
  return {
    getRepository: jest.fn().mockReturnValue({
      find: jest.fn().mockResolvedValue(rows),
    }),
  } as unknown as DataSource;
}

describe('findAllPapersForBrowse', () => {
  it('sorts a paper\'s authors alphabetically, regardless of the order returned by the query', async () => {
    const dataSource = fakeDataSourceWith([
      {
        paperNumber: 18,
        title: 'Jointly Authored Test Paper',
        authors: [{ name: 'Madison' }, { name: 'Hamilton' }],
      },
    ]);

    const rows = await findAllPapersForBrowse(dataSource);

    expect(rows[0].authorNames).toEqual(['Hamilton', 'Madison']);
  });

  it('sorts authors alphabetically even when given in reverse order', async () => {
    const dataSource = fakeDataSourceWith([
      {
        paperNumber: 999,
        title: 'Reverse Order Test Paper',
        authors: [{ name: 'Zeta' }, { name: 'Mu' }, { name: 'Alpha' }],
      },
    ]);

    const rows = await findAllPapersForBrowse(dataSource);

    expect(rows[0].authorNames).toEqual(['Alpha', 'Mu', 'Zeta']);
  });

  it('maps paperNumber and title through unchanged', async () => {
    const dataSource = fakeDataSourceWith([
      { paperNumber: 1, title: 'General Introduction', authors: [{ name: 'Hamilton' }] },
    ]);

    const rows = await findAllPapersForBrowse(dataSource);

    expect(rows).toEqual([
      { paperNumber: 1, title: 'General Introduction', authorNames: ['Hamilton'] },
    ]);
  });
});
