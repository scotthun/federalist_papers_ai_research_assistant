import { DataSource } from 'typeorm';
import { FederalistPaper } from './entities/federalist-paper.entity';

export interface PaperBrowseRow {
  paperNumber: number;
  title: string;
  authorNames: string[];
}

/**
 * Read-only query for the Browse Papers view (CAP-1) -- lists every ingested paper with its
 * author names, sorted by `paperNumber`. Kept separate from paper-ingestion.repository.ts (the
 * write path) since this has none of the transactional/idempotency concerns that govern that
 * file; a plain repository read, reusing Story 1.2's entities.
 *
 * Author names are sorted alphabetically per paper rather than trusting the join table's row
 * order -- Postgres doesn't guarantee that order without an explicit `ORDER BY` on the join,
 * and sorting here is what makes joint-authorship papers (18-20, 62-63) render deterministically
 * as "Hamilton, Madison" rather than depending on incidental insert order.
 */
export async function findAllPapersForBrowse(
  dataSource: DataSource,
): Promise<PaperBrowseRow[]> {
  const papers = await dataSource.getRepository(FederalistPaper).find({
    relations: { authors: true },
    order: { paperNumber: 'ASC' },
  });

  return papers.map((paper) => ({
    paperNumber: paper.paperNumber,
    title: paper.title,
    authorNames: paper.authors
      .map((author) => author.name)
      .sort((a, b) => a.localeCompare(b)),
  }));
}
