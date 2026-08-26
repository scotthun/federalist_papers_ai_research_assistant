import type { AIProvider } from '@federalist-research/ai';
import {
  Author,
  FederalistPaper,
  createDataSource,
  upsertPaperWithChunks,
} from '@federalist-research/database';
import { DataSource } from 'typeorm';
import { retrieveRelevantChunks } from './retrieval';

/**
 * Real-Postgres+pgvector integration test for `retrieveRelevantChunks`'s SQL correctness --
 * DATABASE_URL-gated (skipped, not failed, when no DB is available) so `nx run-many -t test`
 * stays green with no DB, same layering as `paper-search.repository.integration.spec.ts` /
 * `paper-ingestion.repository.integration.spec.ts`. `npm run test:db-integration` is what
 * actually exercises this.
 *
 * The embedding model is never called for real here -- every "query" below is a plain string key
 * into a hand-crafted, deterministic 3072-dim vector via a fake `AIProvider`
 * (`fakeAiProviderFor`), matching this story's Boundaries ("automated tests... use real
 * Postgres+pgvector with hand-crafted, deterministic embedding vectors -- not real Gemini calls").
 * Only `eval-retrieval.ts` calls the real embedding model.
 *
 * Every fixture vector is axis-aligned in an unused corner of the 3072-dim space (indices >=20,
 * distinct per scenario) so this test's assertions hold regardless of whether the real 85-paper
 * corpus (with its own, effectively-random real embeddings) also exists in the same database --
 * a decoy fixture's cosine similarity is pinned to the theoretical maximum (1.0, literally the
 * same vector as the query), which no unrelated real embedding can realistically tie or beat, and
 * a target fixture's is pinned to exactly 0 (orthogonal) on a *different* axis than any decoy --
 * same discipline as `paper-search.repository.integration.spec.ts`'s out-of-range paper numbers,
 * applied to vector space instead of paper-number space.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeWithDb = DATABASE_URL ? describe : describe.skip;

const DIM = 3072;

function zeroVector(): number[] {
  return new Array(DIM).fill(0);
}

function axisVector(index: number, value = 1): number[] {
  const v = zeroVector();
  v[index] = value;
  return v;
}

function blendVector(indexA: number, indexB: number): number[] {
  const v = zeroVector();
  const s = 1 / Math.sqrt(2);
  v[indexA] = s;
  v[indexB] = s;
  return v;
}

function fakeAiProviderFor(queryToEmbedding: Record<string, number[]>): AIProvider {
  return {
    generateEmbedding: async (text: string) => {
      const embedding = queryToEmbedding[text];
      if (!embedding) {
        throw new Error(`No fixture embedding registered for query "${text}"`);
      }
      return embedding;
    },
    generateStructuredOutput: async () => {
      throw new Error('generateStructuredOutput is not used by retrieveRelevantChunks');
    },
  };
}

// Ordering + score-correctness fixtures (axes 10/11).
const ORDERING_QUERY = 'retrieval integration test: ordering query';
const ORDERING_QUERY_VECTOR = axisVector(10);
const ORDERING_PAPER_NUMBER = 999940;

// paperNumber filter-before-limit fixtures (axes 20/21).
const PAPER_NUMBER_FILTER_QUERY = 'retrieval integration test: paperNumber filter query';
const PAPER_NUMBER_FILTER_QUERY_VECTOR = axisVector(20);
const PN_DECOY_PAPER_NUMBERS = [999950, 999951, 999952, 999953, 999954];
const PN_TARGET_PAPER_NUMBER = 999955;

// author filter-before-limit fixtures (axes 30/31).
const AUTHOR_FILTER_QUERY = 'retrieval integration test: author filter query';
const AUTHOR_FILTER_QUERY_VECTOR = axisVector(30);
const AUTHOR_DECOY_PAPER_NUMBERS = [999960, 999961, 999962, 999963];
const AUTHOR_TARGET_PAPER_NUMBER = 999964;
// Deliberately no shared substring between the decoy and target author names (beyond common
// English words) -- sharing a prefix here previously caused a false failure: the author filter
// correctly matched every fixture paper whose author *name* satisfied the ILIKE substring, and
// if that substring is a prefix shared by both decoy and target authors, the decoys' higher
// similarity legitimately fills the topK window before the target, which is filter-before-limit
// working exactly as intended -- just not what a same-prefix fixture can distinguish.
const DECOY_AUTHOR = 'Unrelated Contributor Zzyzx';
const TARGET_AUTHOR = 'Zephyrine Quillfeather';
const TARGET_CO_AUTHOR = 'Bartholomew Winklestone';

const ALL_FIXTURE_PAPER_NUMBERS = [
  ORDERING_PAPER_NUMBER,
  ...PN_DECOY_PAPER_NUMBERS,
  PN_TARGET_PAPER_NUMBER,
  ...AUTHOR_DECOY_PAPER_NUMBERS,
  AUTHOR_TARGET_PAPER_NUMBER,
];

describeWithDb('retrieveRelevantChunks (Story 2.2 integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource(DATABASE_URL as string);
    await dataSource.initialize();
    await dataSource.runMigrations();

    // Ordering fixture: one paper, three chunks at decreasing cosine similarity to
    // ORDERING_QUERY_VECTOR (1.0 exact match, ~0.7071 45-degree blend, 0 orthogonal).
    await upsertPaperWithChunks(dataSource, {
      paperNumber: ORDERING_PAPER_NUMBER,
      title: 'Retrieval Integration Test: Ordering Paper',
      authorNames: [DECOY_AUTHOR],
      sourceUrl: 'https://example.test/retrieval-ordering.asp',
      fullText: 'Fixture paper for retrieval ordering/score assertions.',
      chunks: [
        { chunkIndex: 0, content: 'High-similarity chunk.', embedding: axisVector(10) },
        { chunkIndex: 1, content: 'Medium-similarity chunk.', embedding: blendVector(10, 11) },
        { chunkIndex: 2, content: 'Low-similarity chunk.', embedding: axisVector(11) },
      ],
    });

    // paperNumber filter-before-limit fixtures: 5 decoys at the theoretical-max cosine
    // similarity (1.0, identical vector to the query) so they always occupy an unfiltered
    // top-5 ahead of literally any other content, plus one target paper, on a different axis,
    // orthogonal (cosine 0) to the query -- guaranteed excluded from that same unfiltered top-5.
    for (const [i, paperNumber] of PN_DECOY_PAPER_NUMBERS.entries()) {
      await upsertPaperWithChunks(dataSource, {
        paperNumber,
        title: `Retrieval Integration Test: paperNumber Filter Decoy ${i}`,
        authorNames: [DECOY_AUTHOR],
        sourceUrl: `https://example.test/retrieval-pn-decoy-${i}.asp`,
        fullText: 'Decoy fixture, high similarity, no filter should ever need to exclude it.',
        chunks: [
          { chunkIndex: 0, content: `Decoy chunk ${i}.`, embedding: axisVector(20) },
        ],
      });
    }
    await upsertPaperWithChunks(dataSource, {
      paperNumber: PN_TARGET_PAPER_NUMBER,
      title: 'Retrieval Integration Test: paperNumber Filter Target',
      authorNames: [DECOY_AUTHOR],
      sourceUrl: 'https://example.test/retrieval-pn-target.asp',
      fullText: 'Target fixture: low similarity, only reachable via the paperNumber filter.',
      chunks: [
        { chunkIndex: 0, content: 'Target chunk, orthogonal to the query vector.', embedding: axisVector(21) },
      ],
    });

    // author filter-before-limit fixtures: same shape, on a separate axis pair, with the
    // decoys credited to a different author than the target so the filtered query can prove it
    // narrows to *only* the target. The target is jointly authored (TARGET_AUTHOR +
    // TARGET_CO_AUTHOR) so the same fixture also proves joint-authorship inclusion.
    for (const [i, paperNumber] of AUTHOR_DECOY_PAPER_NUMBERS.entries()) {
      await upsertPaperWithChunks(dataSource, {
        paperNumber,
        title: `Retrieval Integration Test: author Filter Decoy ${i}`,
        authorNames: [DECOY_AUTHOR],
        sourceUrl: `https://example.test/retrieval-author-decoy-${i}.asp`,
        fullText: 'Decoy fixture, high similarity, credited to a different author than the target.',
        chunks: [
          { chunkIndex: 0, content: `Decoy chunk ${i}.`, embedding: axisVector(30) },
        ],
      });
    }
    await upsertPaperWithChunks(dataSource, {
      paperNumber: AUTHOR_TARGET_PAPER_NUMBER,
      title: 'Retrieval Integration Test: author Filter Target',
      authorNames: [TARGET_CO_AUTHOR, TARGET_AUTHOR],
      sourceUrl: 'https://example.test/retrieval-author-target.asp',
      fullText: 'Target fixture: low similarity, only reachable via the author filter.',
      chunks: [
        { chunkIndex: 0, content: 'Target chunk, orthogonal to the query vector.', embedding: axisVector(31) },
      ],
    });
  });

  afterAll(async () => {
    for (const paperNumber of ALL_FIXTURE_PAPER_NUMBERS) {
      await dataSource.getRepository(FederalistPaper).delete({ paperNumber });
    }
    await dataSource.getRepository(Author).delete({ name: DECOY_AUTHOR });
    await dataSource.getRepository(Author).delete({ name: TARGET_AUTHOR });
    await dataSource.getRepository(Author).delete({ name: TARGET_CO_AUTHOR });
    await dataSource.destroy();
  });

  it('orders chunks by descending similarity and returns score = 1 - distance, never a raw distance', async () => {
    const aiProvider = fakeAiProviderFor({ [ORDERING_QUERY]: ORDERING_QUERY_VECTOR });

    const result = await retrieveRelevantChunks(dataSource, aiProvider, ORDERING_QUERY, {
      paperNumber: ORDERING_PAPER_NUMBER,
      topK: 3,
    });

    expect(result.map((r) => r.content)).toEqual([
      'High-similarity chunk.',
      'Medium-similarity chunk.',
      'Low-similarity chunk.',
    ]);

    // Exact match (cosine similarity 1) -- a raw distance would read ~0 here, not ~1. This is
    // the discriminating assertion that score is similarity, not distance.
    expect(result[0].score).toBeGreaterThan(0.95);
    // 45-degree blend -- cosine similarity ~0.7071. A wide-ish tolerance absorbs the HNSW
    // index's halfvec (half-precision) rounding on the stored/query vectors.
    expect(result[1].score).toBeGreaterThan(0.6);
    expect(result[1].score).toBeLessThan(0.8);
    // Orthogonal (cosine similarity 0) -- a raw distance would read ~1 here, not ~0.
    expect(result[2].score).toBeGreaterThan(-0.05);
    expect(result[2].score).toBeLessThan(0.05);

    // Strictly descending, regardless of the exact tolerances above.
    expect(result[0].score).toBeGreaterThan(result[1].score);
    expect(result[1].score).toBeGreaterThan(result[2].score);
  });

  it('excludes the low-similarity target from an unfiltered top-K that the high-similarity decoys fill', async () => {
    const aiProvider = fakeAiProviderFor({
      [PAPER_NUMBER_FILTER_QUERY]: PAPER_NUMBER_FILTER_QUERY_VECTOR,
    });

    const result = await retrieveRelevantChunks(dataSource, aiProvider, PAPER_NUMBER_FILTER_QUERY, {
      topK: PN_DECOY_PAPER_NUMBERS.length,
    });

    const returnedPaperNumbers = result.map((r) => r.paperNumber).sort((a, b) => a - b);
    expect(returnedPaperNumbers).toEqual([...PN_DECOY_PAPER_NUMBERS].sort((a, b) => a - b));
    expect(returnedPaperNumbers).not.toContain(PN_TARGET_PAPER_NUMBER);
  });

  // The load-bearing proof (AD-7/NFR6): the target's chunk would NOT be in an unfiltered top-K
  // (proven above) because 5 decoy chunks strictly outrank it. If the paperNumber filter were
  // applied post-hoc to that same already-limited top-K, filtering it down to "only paper
  // PN_TARGET_PAPER_NUMBER" would yield an empty array, since the target was never in that top-K
  // to begin with. Getting the target's chunk back here proves the filter instead narrowed the
  // SQL WHERE clause's candidate set *before* the LIMIT ran, changing what got limited -- not
  // just what got returned from an already-limited set.
  it('still returns the low-similarity target chunk when paperNumber-filtered, even though it would never survive an unfiltered top-K', async () => {
    const aiProvider = fakeAiProviderFor({
      [PAPER_NUMBER_FILTER_QUERY]: PAPER_NUMBER_FILTER_QUERY_VECTOR,
    });

    const result = await retrieveRelevantChunks(dataSource, aiProvider, PAPER_NUMBER_FILTER_QUERY, {
      topK: PN_DECOY_PAPER_NUMBERS.length,
      paperNumber: PN_TARGET_PAPER_NUMBER,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paperNumber: PN_TARGET_PAPER_NUMBER,
      content: 'Target chunk, orthogonal to the query vector.',
    });
  });

  it('excludes the low-similarity author-filter target from an unfiltered top-K that the decoys fill', async () => {
    const aiProvider = fakeAiProviderFor({ [AUTHOR_FILTER_QUERY]: AUTHOR_FILTER_QUERY_VECTOR });

    const result = await retrieveRelevantChunks(dataSource, aiProvider, AUTHOR_FILTER_QUERY, {
      topK: AUTHOR_DECOY_PAPER_NUMBERS.length,
    });

    const returnedPaperNumbers = result.map((r) => r.paperNumber).sort((a, b) => a - b);
    expect(returnedPaperNumbers).toEqual([...AUTHOR_DECOY_PAPER_NUMBERS].sort((a, b) => a - b));
    expect(returnedPaperNumbers).not.toContain(AUTHOR_TARGET_PAPER_NUMBER);
  });

  // Same load-bearing proof as the paperNumber case above, for the author filter: the target is
  // only reachable when the filter narrows the WHERE clause before the LIMIT, not after. Also
  // proves case-insensitive substring matching and joint-authorship inclusion (the target is
  // jointly credited to TARGET_AUTHOR and TARGET_CO_AUTHOR; matching on a lowercase substring of
  // just TARGET_AUTHOR's name still finds it).
  it('still returns the low-similarity target chunk when author-filtered (case-insensitive, joint authorship), even though it would never survive an unfiltered top-K', async () => {
    const aiProvider = fakeAiProviderFor({ [AUTHOR_FILTER_QUERY]: AUTHOR_FILTER_QUERY_VECTOR });
    // "zephyrine" is unique to TARGET_AUTHOR among this test's fixtures -- lowercased to also
    // prove the match is case-insensitive.
    const lowercaseSubstring = 'zephyrine';

    const result = await retrieveRelevantChunks(dataSource, aiProvider, AUTHOR_FILTER_QUERY, {
      topK: AUTHOR_DECOY_PAPER_NUMBERS.length,
      author: lowercaseSubstring,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      paperNumber: AUTHOR_TARGET_PAPER_NUMBER,
      content: 'Target chunk, orthogonal to the query vector.',
    });
  });

  it('returns an empty array, not an error, for an empty query', async () => {
    const aiProvider = fakeAiProviderFor({});

    await expect(retrieveRelevantChunks(dataSource, aiProvider, '   ')).resolves.toEqual([]);
  });
});
