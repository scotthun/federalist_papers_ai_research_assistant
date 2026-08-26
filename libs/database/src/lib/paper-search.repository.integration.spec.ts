import { DataSource } from 'typeorm';
import { createDataSource } from './data-source';
import { Author } from './entities/author.entity';
import { FederalistPaper } from './entities/federalist-paper.entity';
import { searchPapers } from './paper-search.repository';
import { upsertPaperWithChunks } from './paper-ingestion.repository';

/**
 * Real-Postgres integration test for the "Quick find" search read path (Story 2.1) -- mirrors
 * paper-browse.repository.integration.spec.ts's / paper-detail.repository.integration.spec.ts's
 * DATABASE_URL-gated pattern so `nx run-many -t test` still passes with no DB available, and
 * `npm run test:db-integration` exercises it for real. This is where the story's real
 * acceptance criteria actually get proven: real ILIKE matching, real joint-authorship joins, and
 * real per-paper dedup -- none of which the pure-JS unit spec can exercise honestly.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

// Paper numbers picked well outside the real 1-85 corpus so this test never collides with real
// ingested data sharing the same database.
const SOLO_PAPER_NUMBER = 999920;
const JOINT_PAPER_NUMBER = 999921;
const UNRELATED_PAPER_NUMBER = 999922;
const LITERAL_WILDCARD_PAPER_NUMBER = 999923;
const LITERAL_WILDCARD_DECOY_PAPER_NUMBER = 999924;

const SHARED_AUTHOR = 'Integration Test Search Author Shared';
const OTHER_AUTHOR = 'Integration Test Search Author Other';
const VALID_EMBEDDING = Array.from({ length: 3072 }, (_, i) => i / 3072);

describeWithDb('searchPapers (Story 2.1 integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource(DATABASE_URL as string);
    await dataSource.initialize();
    await dataSource.runMigrations();

    // Fixtures are seeded once for the whole suite (rather than per-test) since every test here
    // only reads -- SOLO_PAPER_NUMBER is solely authored, JOINT_PAPER_NUMBER shares SHARED_AUTHOR
    // with it but is also credited to a second author (mirrors Nos. 18-20/62-63's joint
    // authorship), and JOINT_PAPER_NUMBER's title deliberately also contains "Shared" so a search
    // for "Shared" matches it on *both* title and author -- proving the dedup guarantee, not just
    // the author-search guarantee. UNRELATED_PAPER_NUMBER shares no author with the other two and
    // exists to prove title/keyword search doesn't over-match.
    await upsertPaperWithChunks(dataSource, {
      paperNumber: SOLO_PAPER_NUMBER,
      title: 'Solo Search Test Paper',
      authorNames: [SHARED_AUTHOR],
      sourceUrl: 'https://example.test/search-solo.asp',
      fullText: 'Alpha keyword content, found nowhere else in this fixture set.',
      chunks: [{ chunkIndex: 0, content: 'Alpha keyword content.', embedding: VALID_EMBEDDING }],
    });
    await upsertPaperWithChunks(dataSource, {
      paperNumber: JOINT_PAPER_NUMBER,
      title: 'Paper Shared By Two Authors Search Test',
      // Non-alphabetical insertion order, same discipline as the browse/detail integration
      // specs, so a pass here can't be an accident of insertion order.
      authorNames: [OTHER_AUTHOR, SHARED_AUTHOR],
      sourceUrl: 'https://example.test/search-joint.asp',
      fullText: 'Beta keyword content, found nowhere else in this fixture set.',
      chunks: [{ chunkIndex: 0, content: 'Beta keyword content.', embedding: VALID_EMBEDDING }],
    });
    await upsertPaperWithChunks(dataSource, {
      paperNumber: UNRELATED_PAPER_NUMBER,
      title: 'Unrelated Search Test Paper',
      authorNames: [OTHER_AUTHOR],
      sourceUrl: 'https://example.test/search-unrelated.asp',
      fullText: 'Gamma keyword content, found nowhere else in this fixture set.',
      chunks: [{ chunkIndex: 0, content: 'Gamma keyword content.', embedding: VALID_EMBEDDING }],
    });
    // A literal "%" in the fixture's full text plus a decoy whose text an *unescaped* ILIKE
    // wildcard would wrongly match (any chars where the escaped "%" should require nothing) --
    // together these prove a literal "%" typed by a user is matched literally, not reinterpreted
    // as a SQL wildcard (this story's "case-insensitive substring" contract).
    await upsertPaperWithChunks(dataSource, {
      paperNumber: LITERAL_WILDCARD_PAPER_NUMBER,
      title: 'Literal Wildcard Character Search Test Paper',
      authorNames: [OTHER_AUTHOR],
      sourceUrl: 'https://example.test/search-literal-wildcard.asp',
      fullText: 'This fixture contains a literal 50% discount marker for wildcard-escaping tests.',
      chunks: [
        { chunkIndex: 0, content: 'Literal 50% discount marker.', embedding: VALID_EMBEDDING },
      ],
    });
    await upsertPaperWithChunks(dataSource, {
      paperNumber: LITERAL_WILDCARD_DECOY_PAPER_NUMBER,
      title: 'Literal Wildcard Character Search Decoy Paper',
      authorNames: [OTHER_AUTHOR],
      sourceUrl: 'https://example.test/search-literal-wildcard-decoy.asp',
      fullText:
        'This decoy fixture contains a 50XX discount marker that an unescaped % wildcard would wrongly match.',
      chunks: [
        { chunkIndex: 0, content: 'Decoy 50XX discount marker.', embedding: VALID_EMBEDDING },
      ],
    });
  });

  afterAll(async () => {
    await dataSource.getRepository(FederalistPaper).delete({ paperNumber: SOLO_PAPER_NUMBER });
    await dataSource.getRepository(FederalistPaper).delete({ paperNumber: JOINT_PAPER_NUMBER });
    await dataSource
      .getRepository(FederalistPaper)
      .delete({ paperNumber: UNRELATED_PAPER_NUMBER });
    await dataSource
      .getRepository(FederalistPaper)
      .delete({ paperNumber: LITERAL_WILDCARD_PAPER_NUMBER });
    await dataSource
      .getRepository(FederalistPaper)
      .delete({ paperNumber: LITERAL_WILDCARD_DECOY_PAPER_NUMBER });
    await dataSource.getRepository(Author).delete({ name: SHARED_AUTHOR });
    await dataSource.getRepository(Author).delete({ name: OTHER_AUTHOR });
    await dataSource.destroy();
  });

  it('returns exactly the matching paper when the query is a plain paper number', async () => {
    const result = await searchPapers(dataSource, String(SOLO_PAPER_NUMBER));

    expect(result).toEqual([
      {
        paperNumber: SOLO_PAPER_NUMBER,
        title: 'Solo Search Test Paper',
        authorNames: [SHARED_AUTHOR],
      },
    ]);
  });

  it('returns every solely- and jointly-authored paper credited to a searched author, each exactly once', async () => {
    const result = await searchPapers(dataSource, 'Search Author Shared');
    const testRows = result.filter((row) =>
      [SOLO_PAPER_NUMBER, JOINT_PAPER_NUMBER, UNRELATED_PAPER_NUMBER].includes(row.paperNumber),
    );

    expect(testRows.map((row) => row.paperNumber)).toEqual([
      SOLO_PAPER_NUMBER,
      JOINT_PAPER_NUMBER,
    ]);

    const solo = testRows.find((row) => row.paperNumber === SOLO_PAPER_NUMBER);
    expect(solo?.authorNames).toEqual([SHARED_AUTHOR]);

    const joint = testRows.find((row) => row.paperNumber === JOINT_PAPER_NUMBER);
    // Every credited author is present, sorted alphabetically -- never an arbitrary single pick,
    // same guarantee as the browse/detail read paths.
    expect(joint?.authorNames).toEqual([OTHER_AUTHOR, SHARED_AUTHOR]);
  });

  it('lists a paper exactly once even when it matches on both its title and an author name', async () => {
    // "Shared" appears both in JOINT_PAPER_NUMBER's title ("Paper Shared By Two Authors...") and
    // in SHARED_AUTHOR's name -- a naive un-deduped join would return it twice.
    const result = await searchPapers(dataSource, 'Shared');
    const matches = result.filter((row) => row.paperNumber === JOINT_PAPER_NUMBER);

    expect(matches).toHaveLength(1);
  });

  it('matches a title substring, case-insensitively', async () => {
    const result = await searchPapers(dataSource, 'unrelated search test'.toUpperCase());
    const testRows = result.filter((row) => row.paperNumber === UNRELATED_PAPER_NUMBER);

    expect(testRows).toHaveLength(1);
  });

  it('matches a full-text keyword that appears nowhere in the title or author names', async () => {
    const result = await searchPapers(dataSource, 'Gamma keyword');

    expect(result.map((row) => row.paperNumber)).toEqual([UNRELATED_PAPER_NUMBER]);
  });

  it('returns an empty array, not an error, when nothing matches', async () => {
    await expect(
      searchPapers(dataSource, 'zzzz-no-such-paper-should-ever-match-zzzz'),
    ).resolves.toEqual([]);
  });

  it('matches a literal "%" in the search term against only the paper containing that literal substring, without over-matching via an unescaped wildcard', async () => {
    const result = await searchPapers(dataSource, '50% discount');
    const testRows = result.filter((row) =>
      [LITERAL_WILDCARD_PAPER_NUMBER, LITERAL_WILDCARD_DECOY_PAPER_NUMBER].includes(
        row.paperNumber,
      ),
    );

    // An unescaped "%" in the query would compile to the ILIKE pattern `%50% discount%`, whose
    // middle "%" is a wildcard matching zero or more of any character -- which would wrongly
    // match the decoy's "50XX discount" too. Escaped, only the fixture with a literal "%"
    // matches.
    expect(testRows.map((row) => row.paperNumber)).toEqual([LITERAL_WILDCARD_PAPER_NUMBER]);
  });
});
