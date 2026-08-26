import { DataSource } from 'typeorm';
import { createDataSource } from './data-source';
import { Author } from './entities/author.entity';
import { FederalistPaper } from './entities/federalist-paper.entity';
import { findAllPapersForBrowse } from './paper-browse.repository';
import { upsertPaperWithChunks } from './paper-ingestion.repository';

/**
 * Real-Postgres integration test for the Browse Papers read path (CAP-1, Story 1.3) -- mirrors
 * paper-ingestion.repository.integration.spec.ts's DATABASE_URL-gated pattern so `nx run-many -t
 * test` still passes with no DB available, and `npm run test:db-integration` exercises it for
 * real.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

// Paper numbers picked well outside the real 1-85 corpus so this test never collides with real
// ingested data sharing the same database.
const SOLO_PAPER_NUMBER = 999902;
const JOINT_PAPER_NUMBER = 999903;
const SOLO_AUTHOR_NAME = 'Integration Test Solo Author';
const JOINT_AUTHOR_NAMES = ['Integration Test Author Z', 'Integration Test Author A'];
const VALID_EMBEDDING = Array.from({ length: 3072 }, (_, i) => i / 3072);

describeWithDb('findAllPapersForBrowse (CAP-1 integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource(DATABASE_URL as string);
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  const cleanUp = async () => {
    await dataSource
      .getRepository(FederalistPaper)
      .delete({ paperNumber: SOLO_PAPER_NUMBER });
    await dataSource
      .getRepository(FederalistPaper)
      .delete({ paperNumber: JOINT_PAPER_NUMBER });
    await dataSource.getRepository(Author).delete({ name: SOLO_AUTHOR_NAME });
    for (const name of JOINT_AUTHOR_NAMES) {
      await dataSource.getRepository(Author).delete({ name });
    }
  };

  beforeEach(cleanUp);
  afterEach(cleanUp);

  it('lists papers sorted by paperNumber, with every credited author included and sorted alphabetically', async () => {
    // Inserted out of paperNumber order, and with authors in a non-alphabetical order, so a
    // pass here can't be an accident of insertion order.
    await upsertPaperWithChunks(dataSource, {
      paperNumber: JOINT_PAPER_NUMBER,
      title: 'Jointly Authored Test Paper',
      authorNames: JOINT_AUTHOR_NAMES, // ['... Z', '... A']
      sourceUrl: 'https://example.test/joint.asp',
      fullText: 'Paragraph one.',
      chunks: [{ chunkIndex: 0, content: 'Paragraph one.', embedding: VALID_EMBEDDING }],
    });
    await upsertPaperWithChunks(dataSource, {
      paperNumber: SOLO_PAPER_NUMBER,
      title: 'Solely Authored Test Paper',
      authorNames: [SOLO_AUTHOR_NAME],
      sourceUrl: 'https://example.test/solo.asp',
      fullText: 'Paragraph one.',
      chunks: [{ chunkIndex: 0, content: 'Paragraph one.', embedding: VALID_EMBEDDING }],
    });

    const rows = await findAllPapersForBrowse(dataSource);
    const testRows = rows.filter((row) =>
      [SOLO_PAPER_NUMBER, JOINT_PAPER_NUMBER].includes(row.paperNumber),
    );

    // Sorted by paperNumber ascending, regardless of insertion order.
    expect(testRows.map((row) => row.paperNumber)).toEqual([
      SOLO_PAPER_NUMBER,
      JOINT_PAPER_NUMBER,
    ]);

    const solo = testRows.find((row) => row.paperNumber === SOLO_PAPER_NUMBER);
    expect(solo).toMatchObject({
      title: 'Solely Authored Test Paper',
      authorNames: [SOLO_AUTHOR_NAME],
    });

    const joint = testRows.find((row) => row.paperNumber === JOINT_PAPER_NUMBER);
    // Every credited author is present, sorted alphabetically -- never an arbitrary single pick.
    expect(joint?.authorNames).toEqual([
      'Integration Test Author A',
      'Integration Test Author Z',
    ]);
  });
});
