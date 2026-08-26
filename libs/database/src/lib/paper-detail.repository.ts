import { DataSource } from 'typeorm';
import { FederalistPaper } from './entities/federalist-paper.entity';

export interface PaperDetailRow {
  paperNumber: number;
  title: string;
  authorNames: string[];
  fullText: string;
  sourceUrl: string;
}

/**
 * Read-only query for the Paper Reader view (Story 1.4) -- one paper by `paperNumber`, including
 * every credited author, or `null` when no paper with that number has been ingested. Kept
 * separate from `paper-browse.repository.ts` (the list read) and `paper-ingestion.repository.ts`
 * (the write path) since this has none of their list-shaping or transactional/idempotency
 * concerns -- a plain single-row repository read, reusing Story 1.2's entities.
 *
 * Author names are sorted alphabetically per paper, same as the browse repository and for the
 * same reason: Postgres doesn't guarantee join-table row order without an explicit `ORDER BY`,
 * and sorting here is what makes joint-authorship papers (18-20, 62-63) render deterministically
 * as "Hamilton, Madison" rather than depending on incidental insert order.
 */
export async function findPaperDetailByNumber(
  dataSource: DataSource,
  paperNumber: number,
): Promise<PaperDetailRow | null> {
  const paper = await dataSource.getRepository(FederalistPaper).findOne({
    where: { paperNumber },
    relations: { authors: true },
  });

  if (!paper) {
    return null;
  }

  return {
    paperNumber: paper.paperNumber,
    title: paper.title,
    authorNames: paper.authors
      .map((author) => author.name)
      .sort((a, b) => a.localeCompare(b)),
    fullText: paper.fullText,
    sourceUrl: paper.sourceUrl,
  };
}
