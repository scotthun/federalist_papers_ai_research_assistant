import { DataSource } from 'typeorm';
import { PapersService } from './papers.service';

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
  return new PapersService(dataSource);
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
});
