import { DataSource, EntityManager } from 'typeorm';
import { Author } from './entities/author.entity';
import { DocumentChunk } from './entities/document-chunk.entity';
import { FederalistPaper } from './entities/federalist-paper.entity';

export interface ChunkInput {
  chunkIndex: number;
  content: string;
  embedding: number[];
  section?: string | null;
  heading?: string | null;
  pageNumber?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpsertPaperInput {
  paperNumber: number;
  title: string;
  authorNames: string[];
  sourceUrl: string;
  fullText: string;
  publicationDate?: string | null;
  chunks: ChunkInput[];
}

// Safe as a plain find-then-create only because callers (apps/api's ingest orchestrator)
// process papers one at a time, never in parallel -- there is no race against the
// `authors_name_uq` constraint today. A parallelized caller upserting the same new author name
// from two transactions concurrently would reintroduce that race; this function does not guard
// against it.
async function findOrCreateAuthor(
  manager: EntityManager,
  name: string,
): Promise<Author> {
  const existing = await manager.findOne(Author, { where: { name } });
  if (existing) return existing;
  return manager.save(manager.create(Author, { name }));
}

/**
 * Upserts one FederalistPaper's metadata + authors + chunks as a single DB transaction (AD-10):
 * the metadata upsert, the author find-or-create, the chunk delete, and the chunk insert all
 * run inside the same transaction, so a failure anywhere in this function leaves that paper's
 * prior state (if any) completely unchanged -- nothing partially updated.
 *
 * Idempotent and keyed by `paperNumber` (NFR7): re-running with the same input finds the
 * existing row (rather than blind-inserting) and replaces its chunks (delete-then-insert), so no
 * duplicate FederalistPaper or DocumentChunk rows accumulate across re-runs.
 */
export async function upsertPaperWithChunks(
  dataSource: DataSource,
  input: UpsertPaperInput,
): Promise<FederalistPaper> {
  return dataSource.transaction(async (manager) => {
    const authors = await Promise.all(
      input.authorNames.map((name) => findOrCreateAuthor(manager, name)),
    );

    // Load the existing relation (if any) so save() below can diff the join table correctly --
    // without this, TypeORM has no prior state to compare against and may only ever add rows,
    // never remove stale ones.
    let paper = await manager.findOne(FederalistPaper, {
      where: { paperNumber: input.paperNumber },
      relations: { authors: true },
    });

    if (!paper) {
      paper = manager.create(FederalistPaper, {
        paperNumber: input.paperNumber,
      });
    }

    paper.title = input.title;
    paper.sourceUrl = input.sourceUrl;
    paper.fullText = input.fullText;
    paper.publicationDate = input.publicationDate ?? null;
    paper.authors = authors;

    paper = await manager.save(paper);

    // Delete-then-insert, not an upsert-merge: chunk boundaries/count can legitimately change
    // between re-ingestions (re-chunking, a source text edit), so the old set is never assumed
    // to still be valid.
    await manager.delete(DocumentChunk, { paperId: paper.id });

    if (input.chunks.length > 0) {
      const chunkEntities = input.chunks.map((chunk) =>
        manager.create(DocumentChunk, {
          paper,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          embedding: chunk.embedding,
          section: chunk.section ?? null,
          heading: chunk.heading ?? null,
          pageNumber: chunk.pageNumber ?? null,
          metadata: chunk.metadata ?? null,
        }),
      );
      await manager.save(chunkEntities);
    }

    return paper;
  });
}
