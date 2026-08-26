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
});
