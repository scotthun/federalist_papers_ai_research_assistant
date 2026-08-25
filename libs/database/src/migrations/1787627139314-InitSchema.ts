import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the Epic 1 schema: pgvector extension, `federalist_papers`, `authors`, the
 * auto-managed `federalist_paper_authors` join table, and `document_chunks` (vector(3072) +
 * index). Written as raw SQL (not the structured Table/TableColumn migration API) because
 * pgvector's `vector`/`halfvec` types and the half-precision HNSW expression index below are
 * exotic enough that raw SQL is clearer and less error-prone than fighting the structured API.
 */
export class InitSchema1787627139314 implements MigrationInterface {
  name = 'InitSchema1787627139314';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`
      CREATE TABLE "federalist_papers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "paper_number" integer NOT NULL,
        "title" text NOT NULL,
        "publication_date" date,
        "source_url" text NOT NULL,
        "full_text" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "federalist_papers_paper_number_uq" UNIQUE ("paper_number")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "authors" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "authors_name_uq" UNIQUE ("name")
      )
    `);

    // Plain auto-managed many-to-many join table (no extra columns) -- see
    // FederalistPaper.authors / data-model.md, "Authorship modeling".
    await queryRunner.query(`
      CREATE TABLE "federalist_paper_authors" (
        "paper_id" uuid NOT NULL REFERENCES "federalist_papers"("id") ON DELETE CASCADE,
        "author_id" uuid NOT NULL REFERENCES "authors"("id") ON DELETE CASCADE,
        PRIMARY KEY ("paper_id", "author_id")
      )
    `);

    // vector(3072) matches Gemini's gemini-embedding-001 (verified live against the Gemini API,
    // Story 0.1 spike). Changing the embedding model/dimension later is a deliberate,
    // separately-costed migration (decisions.md), not something this schema stays agnostic to.
    await queryRunner.query(`
      CREATE TABLE "document_chunks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "paper_id" uuid NOT NULL REFERENCES "federalist_papers"("id") ON DELETE CASCADE,
        "chunk_index" integer NOT NULL,
        "content" text NOT NULL,
        "embedding" vector(3072) NOT NULL,
        "section" text,
        "heading" text,
        "page_number" integer,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "document_chunks_paper_chunk_index_uq" UNIQUE ("paper_id", "chunk_index")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "document_chunks_paper_id_idx" ON "document_chunks" ("paper_id")
    `);

    // pgvector's HNSW/IVFFlat indexes cap indexed dimensions at 2000 for `vector` but 4000 for
    // `halfvec` -- index a half-precision cast of the column so a 3072-dim embedding is still
    // ANN-searchable. (The Story 0.1 spike skipped an index entirely at its few-dozen-row scale
    // and flagged this as the thing to revisit once the real 85-paper corpus existed -- this is
    // that revisit.) Retrieval queries (Epic 2) must match this expression -- cast the query
    // vector to halfvec(3072) too, e.g. `ORDER BY embedding::halfvec(3072) <=> $1` -- for the
    // planner to use it.
    await queryRunner.query(`
      CREATE INDEX "document_chunks_embedding_hnsw_idx"
        ON "document_chunks"
        USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "document_chunks_embedding_hnsw_idx"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "document_chunks_paper_id_idx"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "document_chunks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "federalist_paper_authors"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "authors"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "federalist_papers"`);
  }
}
