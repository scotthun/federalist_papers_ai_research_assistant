import type { AIProvider } from '@federalist-research/ai';
import { escapeLikeTerm } from '@federalist-research/database';
import { DataSource } from 'typeorm';

/**
 * One pgvector-similarity search result. `libs/retrieval`'s sole business is turning a natural
 * -language query into `document_chunks` rows ranked by cosine similarity (AD-7) -- never a
 * confidence judgment about what the score means (that's Epic 3's orchestrator, decisions.md's
 * "Confidence tiering"). `chunkId` is only meaningful within the request/response cycle that
 * produced it, never a stable/shareable identifier (decisions.md, "Chunk ID lifetime").
 */
export interface RetrievedChunk {
  chunkId: string;
  paperNumber: number;
  paperTitle: string;
  content: string;
  /** `1 - cosine_distance` (higher is more similar) -- NOT a bounded [0, 1] confidence-style
   *  value. Cosine distance ranges [0, 2], so this ranges roughly [-1, 1]: 1 for an identical
   *  vector, 0 for an orthogonal (unrelated) one, and negative for an anti-correlated one. Never
   *  render or interpret it as a 0-100% confidence score -- that interpretation is explicitly
   *  Epic 3's job (decisions.md, "Confidence tiering"), not this field's contract. */
  score: number;
}

export interface RetrieveOptions {
  /** Number of chunks to return, ranked by similarity (highest score first). Defaults to 5. */
  topK?: number;
  /** Exact `paperNumber` match, applied in the SQL WHERE clause before the topK LIMIT. */
  paperNumber?: number;
  /** Case-insensitive substring match against any credited author's name (joint/disputed
   *  authorship included via `federalist_paper_authors`), applied in the SQL WHERE clause before
   *  the topK LIMIT -- same convention as Story 2.1's `searchPapers` author match. */
  author?: string;
}

/** Exported so callers that redeclare their own "match libs/retrieval's default" literal (e.g.
 *  `apps/api`'s `AskService`/`calibrate-thresholds.ts`) can import and reuse this constant instead
 *  -- a comment merely claiming to match this value doesn't actually enforce it. */
export const DEFAULT_TOP_K = 5;

// Matches the half-precision HNSW index InitSchema1787627139314 builds on the expression
// `(embedding::halfvec(3072))` -- the ORDER BY/score expression here must cast the column the
// same way for Postgres's planner to actually use that index (see the migration's own comment,
// which gives this exact form: `ORDER BY embedding::halfvec(3072) <=> $1`). The bind parameter
// itself is left uncast, exactly as that worked example shows -- Postgres resolves the
// "unknown"-typed text literal against halfvec's `<=>` operator on its own.
const COSINE_DISTANCE_EXPRESSION =
  'chunk.embedding::halfvec(3072) <=> $1';

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

interface RetrievalRow {
  chunkId: string;
  paperNumber: number;
  paperTitle: string;
  content: string;
  score: string | number;
}

/**
 * Embeds `query` via `aiProvider.generateEmbedding` (`libs/ai`) and returns the top
 * `options.topK` `document_chunks` rows (default 5) ordered by pgvector cosine similarity
 * (AD-7) -- `score` is always `1 - distance` (higher is more similar), never a raw distance.
 * That makes `score` range roughly [-1, 1], not a bounded [0, 1]/0-100% confidence value --
 * see `RetrievedChunk.score`'s own doc comment; never treat it as a confidence percentage.
 *
 * `options.paperNumber` (exact) and `options.author` (case-insensitive substring) each filter in
 * the SQL WHERE clause *before* the topK LIMIT -- never applied post-hoc to an already-limited
 * result set (AD-7, NFR6): a single raw query does the embedding-similarity ranking, the
 * filtering, and the limiting together, so a filter can never be layered on top of a result set
 * that was already cut down to topK without it.
 *
 * Applies no confidence-threshold interpretation of its own -- callers get scores only
 * (decisions.md, "Confidence tiering" is Epic 3's orchestrator, not this function's job).
 *
 * An empty/whitespace `query` returns `[]` without ever calling `aiProvider.generateEmbedding` --
 * nothing to embed, nothing to search for, and no reason to spend an embedding-API call on it
 * (I/O Edge-Case Matrix).
 */
export async function retrieveRelevantChunks(
  dataSource: DataSource,
  aiProvider: AIProvider,
  query: string,
  options: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return [];
  }

  const topK = options.topK ?? DEFAULT_TOP_K;
  const queryEmbedding = await aiProvider.generateEmbedding(trimmedQuery);
  const vectorLiteral = toVectorLiteral(queryEmbedding);

  // Positional params, built up alongside the WHERE fragments they belong to -- $1 (the query
  // vector) is reused by both the score expression and the ORDER BY, so every filter param after
  // it is numbered relative to `params.length` at the point it's pushed, and topK's `$N` is
  // computed last, once every filter (or lack of one) is already known.
  const params: unknown[] = [vectorLiteral];
  const conditions: string[] = [];

  if (options.paperNumber !== undefined) {
    params.push(options.paperNumber);
    conditions.push(`paper.paper_number = $${params.length}`);
  }

  const trimmedAuthor = options.author?.trim();
  if (trimmedAuthor !== undefined && trimmedAuthor.length > 0) {
    params.push(`%${escapeLikeTerm(trimmedAuthor)}%`);
    // A correlated EXISTS against the join table (not a JOIN on `authors`) so a paper with
    // multiple co-authors never yields duplicate chunk rows here -- there is nothing to DISTINCT
    // away afterward, unlike paper-search.repository.ts's two-step find-then-rehydrate shape,
    // because this query already returns individual chunks, not one row per paper.
    conditions.push(`EXISTS (
      SELECT 1 FROM federalist_paper_authors fpa
      INNER JOIN authors matched_author ON matched_author.id = fpa.author_id
      WHERE fpa.paper_id = paper.id AND matched_author.name ILIKE $${params.length}
    )`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(topK);
  const topKParamIndex = params.length;

  const rows = await dataSource.query<RetrievalRow[]>(
    `
    SELECT
      chunk.id AS "chunkId",
      paper.paper_number AS "paperNumber",
      paper.title AS "paperTitle",
      chunk.content AS "content",
      1 - (${COSINE_DISTANCE_EXPRESSION}) AS "score"
    FROM document_chunks chunk
    INNER JOIN federalist_papers paper ON paper.id = chunk.paper_id
    ${whereClause}
    -- \`, chunk.id\` is a deterministic secondary sort key only -- it never changes which primary
    -- expression the HNSW index matches (COSINE_DISTANCE_EXPRESSION stays first/unmodified), it
    -- only makes the LIMIT's tie-break among equal-similarity rows stable across runs instead of
    -- depending on whatever order Postgres happens to return ties in.
    ORDER BY ${COSINE_DISTANCE_EXPRESSION}, chunk.id
    LIMIT $${topKParamIndex}
    `,
    params,
  );

  return rows.map((row) => ({
    chunkId: row.chunkId,
    paperNumber: row.paperNumber,
    paperTitle: row.paperTitle,
    content: row.content,
    score: Number(row.score),
  }));
}
