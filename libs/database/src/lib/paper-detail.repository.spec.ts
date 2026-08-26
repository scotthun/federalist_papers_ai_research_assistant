import { DataSource } from 'typeorm';
import { findPaperDetailByNumber } from './paper-detail.repository';

/**
 * Pure-JS unit coverage for findPaperDetailByNumber's author-name sort and not-found handling --
 * no Postgres required. The DB-backed correctness of the underlying query (real lookup, real
 * join) is covered separately by paper-detail.repository.integration.spec.ts, which is
 * DATABASE_URL-gated and skipped by the default `nx run-many -t test`.
 */
function fakeDataSourceWith(row: unknown): DataSource {
  return {
    getRepository: jest.fn().mockReturnValue({
      findOne: jest.fn().mockResolvedValue(row),
    }),
  } as unknown as DataSource;
}

describe('findPaperDetailByNumber', () => {
  it('returns null when no paper with that number exists', async () => {
    const dataSource = fakeDataSourceWith(null);

    await expect(findPaperDetailByNumber(dataSource, 999)).resolves.toBeNull();
  });

  it('maps paperNumber, title, fullText, and sourceUrl through unchanged', async () => {
    const dataSource = fakeDataSourceWith({
      paperNumber: 1,
      title: 'General Introduction',
      fullText: 'Paragraph one.\n\nParagraph two.',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
      authors: [{ name: 'Hamilton' }],
    });

    await expect(findPaperDetailByNumber(dataSource, 1)).resolves.toEqual({
      paperNumber: 1,
      title: 'General Introduction',
      authorNames: ['Hamilton'],
      fullText: 'Paragraph one.\n\nParagraph two.',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
    });
  });

  it("sorts a paper's authors alphabetically, regardless of the order returned by the query", async () => {
    const dataSource = fakeDataSourceWith({
      paperNumber: 18,
      title: 'Jointly Authored Test Paper',
      fullText: 'Text.',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed18.asp',
      authors: [{ name: 'Madison' }, { name: 'Hamilton' }],
    });

    const row = await findPaperDetailByNumber(dataSource, 18);

    expect(row?.authorNames).toEqual(['Hamilton', 'Madison']);
  });
});
