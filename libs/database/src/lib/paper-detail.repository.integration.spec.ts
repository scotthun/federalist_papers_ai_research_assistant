import { DataSource } from 'typeorm';
import { createDataSource } from './data-source';
import { Author } from './entities/author.entity';
import { FederalistPaper } from './entities/federalist-paper.entity';
import { findPaperDetailByNumber } from './paper-detail.repository';
import { upsertPaperWithChunks } from './paper-ingestion.repository';

/**
 * Real-Postgres integration test for the Paper Reader read path (Story 1.4) -- mirrors
 * paper-browse.repository.integration.spec.ts's DATABASE_URL-gated pattern so `nx run-many -t
 * test` still passes with no DB available, and `npm run test:db-integration` exercises it for
 * real.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

// Paper numbers picked well outside the real 1-85 corpus so this test never collides with real
// ingested data sharing the same database.
const SOLO_PAPER_NUMBER = 999904;
const JOINT_PAPER_NUMBER = 999905;
const MISSING_PAPER_NUMBER = 999906;
const SOLO_AUTHOR_NAME = 'Integration Test Solo Author (Detail)';
const JOINT_AUTHOR_NAMES = ['Integration Test Author Z (Detail)', 'Integration Test Author A (Detail)'];
const VALID_EMBEDDING = Array.from({ length: 3072 }, (_, i) => i / 3072);

describeWithDb('findPaperDetailByNumber (Story 1.4 integration)', () => {
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

  it('returns null when no paper with that number has been ingested', async () => {
    await expect(
      findPaperDetailByNumber(dataSource, MISSING_PAPER_NUMBER),
    ).resolves.toBeNull();
  });

  it('returns full text, sourceUrl, and every credited author, sorted alphabetically', async () => {
    await upsertPaperWithChunks(dataSource, {
      paperNumber: JOINT_PAPER_NUMBER,
      title: 'Jointly Authored Test Paper',
      // Inserted in non-alphabetical order so a pass here can't be an accident of insertion order.
      authorNames: JOINT_AUTHOR_NAMES, // ['... Z', '... A']
      sourceUrl: 'https://example.test/joint.asp',
      fullText: 'Paragraph one.\n\nParagraph two.',
      chunks: [{ chunkIndex: 0, content: 'Paragraph one.', embedding: VALID_EMBEDDING }],
    });
    await upsertPaperWithChunks(dataSource, {
      paperNumber: SOLO_PAPER_NUMBER,
      title: 'Solely Authored Test Paper',
      authorNames: [SOLO_AUTHOR_NAME],
      sourceUrl: 'https://example.test/solo.asp',
      fullText: 'Solo paragraph.',
      chunks: [{ chunkIndex: 0, content: 'Solo paragraph.', embedding: VALID_EMBEDDING }],
    });

    const solo = await findPaperDetailByNumber(dataSource, SOLO_PAPER_NUMBER);
    expect(solo).toMatchObject({
      paperNumber: SOLO_PAPER_NUMBER,
      title: 'Solely Authored Test Paper',
      authorNames: [SOLO_AUTHOR_NAME],
      fullText: 'Solo paragraph.',
      sourceUrl: 'https://example.test/solo.asp',
    });

    const joint = await findPaperDetailByNumber(dataSource, JOINT_PAPER_NUMBER);
    // Every credited author is present, sorted alphabetically -- never an arbitrary single pick.
    expect(joint?.authorNames).toEqual([
      'Integration Test Author A (Detail)',
      'Integration Test Author Z (Detail)',
    ]);
    expect(joint?.fullText).toBe('Paragraph one.\n\nParagraph two.');
  });
});
