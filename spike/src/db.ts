import pg from 'pg';
import 'dotenv/config';

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export interface PaperRow {
  id: number;
  paperNumber: number;
  title: string;
  authors: string[];
  sourceUrl: string;
  fullText: string;
}

export async function upsertPaper(input: {
  paperNumber: number;
  title: string;
  authors: string[];
  sourceUrl: string;
  fullText: string;
}): Promise<PaperRow> {
  const { rows } = await getPool().query(
    `INSERT INTO papers (paper_number, title, authors, source_url, full_text)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (paper_number) DO UPDATE
       SET title = EXCLUDED.title, authors = EXCLUDED.authors,
           source_url = EXCLUDED.source_url, full_text = EXCLUDED.full_text
     RETURNING id, paper_number AS "paperNumber", title, authors, source_url AS "sourceUrl", full_text AS "fullText"`,
    [input.paperNumber, input.title, input.authors, input.sourceUrl, input.fullText],
  );
  return rows[0];
}

export async function replaceChunks(
  paperId: number,
  chunks: Array<{ chunkIndex: number; content: string; embedding: number[] }>,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM chunks WHERE paper_id = $1', [paperId]);
    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO chunks (paper_id, chunk_index, content, embedding) VALUES ($1, $2, $3, $4)`,
        [paperId, chunk.chunkIndex, chunk.content, `[${chunk.embedding.join(',')}]`],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface RetrievedChunk {
  chunkId: number;
  paperId: number;
  paperNumber: number;
  paperTitle: string;
  sourceUrl: string;
  content: string;
  score: number;
}

export async function retrieveRelevantChunks(
  queryEmbedding: number[],
  topK: number,
): Promise<RetrievedChunk[]> {
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;
  const { rows } = await getPool().query(
    `SELECT c.id AS "chunkId", c.paper_id AS "paperId", p.paper_number AS "paperNumber",
            p.title AS "paperTitle", p.source_url AS "sourceUrl", c.content,
            1 - (c.embedding <=> $1) AS score
     FROM chunks c
     JOIN papers p ON p.id = c.paper_id
     ORDER BY c.embedding <=> $1
     LIMIT $2`,
    [vectorLiteral, topK],
  );
  return rows;
}
