import { DataSource, In, Repository } from 'typeorm';
import { parsePaperNumberRouteSegment } from '@federalist-research/shared';
import { FederalistPaper } from './entities/federalist-paper.entity';

export interface PaperSearchRow {
  paperNumber: number;
  title: string;
  authorNames: string[];
}

/**
 * Read-only query for the "Quick find" search (Story 2.1): a direct relational query against
 * `libs/database` only -- no embeddings, no `libs/retrieval` involvement, no separate search
 * database (Epic 2 context, this story's Boundaries). `scope:database` is already allowed to
 * depend on `scope:shared` (AD-6/eslint.config.mjs), so `parsePaperNumberRouteSegment` is reused
 * here rather than a second hand-rolled integer check duplicating `apps/api`'s and `apps/web`'s.
 *
 * Two-step query, not one `leftJoinAndSelect` with the match condition folded into `WHERE`: doing
 * it in one query would silently drop non-matching co-authors from the hydrated `paper.authors`
 * whenever a paper matched only through one author's name -- e.g. searching "Madison" would
 * hydrate paper 18 with just Madison, not Hamilton too, which is exactly the joint-authorship bug
 * this story's boundaries exist to prevent (they must appear with every credited author, same as
 * Story 1.3/1.4). So instead: find the *distinct paper ids* that match anything (title, full
 * text, or any author's name), then re-fetch those papers with their full `authors` relation
 * loaded, same pattern as `paper-browse.repository.ts`. The `DISTINCT` in the first step is also
 * what guarantees each matching paper appears exactly once in the final result, regardless of how
 * many fields/authors it matched on.
 */
export async function searchPapers(
  dataSource: DataSource,
  query: string,
): Promise<PaperSearchRow[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    // This repository's job is only to search; there is nothing to search for. Deciding that an
    // empty/whitespace query means "show the unfiltered list instead" is `apps/web`'s page-level
    // concern (I/O matrix, "Empty/whitespace query") -- the Browse Papers page never calls the
    // search endpoint (and this function) when its own `q` is blank.
    return [];
  }

  const repository = dataSource.getRepository(FederalistPaper);
  const asPaperNumber = parsePaperNumberRouteSegment(trimmedQuery);

  const papers =
    asPaperNumber !== null
      ? await repository.find({
          where: { paperNumber: asPaperNumber },
          relations: { authors: true },
        })
      : await findByKeyword(repository, trimmedQuery);

  return papers
    .map((paper) => ({
      paperNumber: paper.paperNumber,
      title: paper.title,
      // Same alphabetical author-name sort as paper-browse.repository.ts and
      // paper-detail.repository.ts, and for the same reason: Postgres doesn't guarantee join-table
      // row order without an explicit ORDER BY on the join.
      authorNames: paper.authors
        .map((author) => author.name)
        .sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.paperNumber - b.paperNumber);
}

// Postgres's ILIKE treats `%`, `_`, and the escape character itself (`\`, the default) as
// pattern metacharacters -- without escaping them here, a user typing a literal `%` or `_`
// (e.g. "50% off") would have it interpreted as a wildcard instead of matched literally, a
// deviation from this story's "case-insensitive substring" contract (Boundaries). Escaping `\`
// first (so a literal backslash in the term isn't itself misread as introducing an escape
// sequence for the characters escaped after it) then wrapping in `%...%` keeps the substring
// match honest while still relying on Postgres's own default `ESCAPE '\'` (no query-level
// `ESCAPE` clause needed).
//
// Exported (Story 2.2) so `libs/retrieval`'s `author` filter reuses this exact escaping instead
// of hand-duplicating it -- same "case-insensitive substring" convention, same edge cases.
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function findByKeyword(
  repository: Repository<FederalistPaper>,
  term: string,
): Promise<FederalistPaper[]> {
  const likeTerm = `%${escapeLikeTerm(term)}%`;

  // ILIKE (case-insensitive) across the paper's own title/full text and, via the join, every
  // credited author's name -- this story's Boundaries, verbatim. `getRawMany` (not `getMany`)
  // deliberately avoids hydrating entities from this query: only the matching ids are needed here,
  // the real hydration happens in the second, relation-loading query below.
  const matches = await repository
    .createQueryBuilder('paper')
    .leftJoin('paper.authors', 'author')
    .select('paper.id', 'id')
    .distinct(true)
    .where('paper.title ILIKE :likeTerm', { likeTerm })
    .orWhere('paper.fullText ILIKE :likeTerm', { likeTerm })
    .orWhere('author.name ILIKE :likeTerm', { likeTerm })
    .getRawMany<{ id: string }>();

  if (matches.length === 0) {
    return [];
  }

  return repository.find({
    where: { id: In(matches.map((row) => row.id)) },
    relations: { authors: true },
  });
}
