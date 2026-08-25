import { DataSource } from 'typeorm';
import { createDataSource } from './data-source';
import { Author } from './entities/author.entity';
import { DocumentChunk } from './entities/document-chunk.entity';
import { FederalistPaper } from './entities/federalist-paper.entity';
import { upsertPaperWithChunks } from './paper-ingestion.repository';

/**
 * Real-Postgres integration test for the AD-10 (one-transaction-per-paper) and NFR7
 * (idempotency) requirements. Requires a reachable Postgres+pgvector (e.g. `docker-compose up`)
 * via DATABASE_URL -- skipped entirely (not failed) when DATABASE_URL isn't set, so `nx
 * run-many -t test` still passes in an environment with no DB available.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const TEST_PAPER_NUMBER = 999901;
const TEST_AUTHOR_NAME = 'Integration Test Author';
// gemini-embedding-001 is 3072-dimensional; the document_chunks.embedding column is `vector(3072)
// NOT NULL`, so Postgres itself rejects a wrong-dimension value -- used below as a real,
// no-mocking-required way to force a failure partway through the chunk-insert step.
const VALID_EMBEDDING = Array.from({ length: 3072 }, (_, i) => i / 3072);
const WRONG_DIMENSION_EMBEDDING = [0.1, 0.2, 0.3];

describeWithDb('upsertPaperWithChunks (AD-10 / NFR7 integration)', () => {
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
      .delete({ paperNumber: TEST_PAPER_NUMBER });
    await dataSource.getRepository(Author).delete({ name: TEST_AUTHOR_NAME });
  };

  beforeEach(cleanUp);
  afterEach(cleanUp);

  it('is idempotent: re-running with unchanged input creates no duplicate rows (NFR7)', async () => {
    const input = {
      paperNumber: TEST_PAPER_NUMBER,
      title: 'Integration Test Paper',
      authorNames: [TEST_AUTHOR_NAME],
      sourceUrl: 'https://example.test/fed-test.asp',
      fullText: 'Paragraph one.\n\nParagraph two.',
      chunks: [
        {
          chunkIndex: 0,
          content: 'Paragraph one.',
          embedding: VALID_EMBEDDING,
        },
        {
          chunkIndex: 1,
          content: 'Paragraph two.',
          embedding: VALID_EMBEDDING,
        },
      ],
    };

    await upsertPaperWithChunks(dataSource, input);
    await upsertPaperWithChunks(dataSource, input);

    const papers = await dataSource
      .getRepository(FederalistPaper)
      .find({ where: { paperNumber: TEST_PAPER_NUMBER } });
    expect(papers).toHaveLength(1);

    const chunks = await dataSource
      .getRepository(DocumentChunk)
      .find({ where: { paperId: papers[0].id } });
    expect(chunks).toHaveLength(2);

    const authors = await dataSource
      .getRepository(Author)
      .find({ where: { name: TEST_AUTHOR_NAME } });
    expect(authors).toHaveLength(1);
  });

  it('rolls back the whole transaction on a mid-paper failure, leaving prior state unchanged (AD-10)', async () => {
    // Seed a known-good prior state.
    await upsertPaperWithChunks(dataSource, {
      paperNumber: TEST_PAPER_NUMBER,
      title: 'Original Title',
      authorNames: [TEST_AUTHOR_NAME],
      sourceUrl: 'https://example.test/original.asp',
      fullText: 'Original content.',
      chunks: [
        {
          chunkIndex: 0,
          content: 'Original content.',
          embedding: VALID_EMBEDDING,
        },
      ],
    });

    // A re-ingestion attempt whose second chunk fails to insert (wrong embedding dimension).
    // By the time that failure happens, this same call has already run the metadata-upsert
    // (new title) and the chunk-delete (removing "Original content.") within the same
    // transaction -- so only a genuine rollback, not merely "skip the bad chunk", can leave the
    // prior state intact.
    await expect(
      upsertPaperWithChunks(dataSource, {
        paperNumber: TEST_PAPER_NUMBER,
        title: 'Attempted New Title',
        authorNames: [TEST_AUTHOR_NAME],
        sourceUrl: 'https://example.test/attempted.asp',
        fullText: 'Attempted new content.',
        chunks: [
          { chunkIndex: 0, content: 'Good chunk.', embedding: VALID_EMBEDDING },
          {
            chunkIndex: 1,
            content: 'Bad chunk.',
            embedding: WRONG_DIMENSION_EMBEDDING,
          },
        ],
      }),
    ).rejects.toThrow();

    const paper = await dataSource
      .getRepository(FederalistPaper)
      .findOne({ where: { paperNumber: TEST_PAPER_NUMBER } });
    expect(paper).not.toBeNull();
    expect(paper?.title).toBe('Original Title');
    expect(paper?.sourceUrl).toBe('https://example.test/original.asp');
    expect(paper?.fullText).toBe('Original content.');

    const chunks = await dataSource
      .getRepository(DocumentChunk)
      .find({ where: { paperId: paper?.id } });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Original content.');
  });
});
