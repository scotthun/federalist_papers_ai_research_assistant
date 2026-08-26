import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import type { RetrievedChunk } from '@federalist-research/retrieval';
import {
  PaperDetail,
  PaperSummary,
  parsePaperNumberRouteSegment,
} from '@federalist-research/shared';
import { PapersService } from './papers.service';

/** Normalizes a query param that Nest/Express resolves to `string[]` on repetition (e.g.
 *  `?q=a&q=b`) down to its first value -- same normalization applied throughout this
 *  controller's params, so a repeated param is never handed to a downstream function expecting
 *  a single string (which would otherwise throw on `.trim()`/similar and produce an unhandled
 *  500). */
function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Upper bound for `?topK=`, enforced by `parsePositiveIntQueryParam`'s `max` param below.
 *  Without this, `?topK=999999` passed straight through as the SQL `LIMIT` -- an unbounded
 *  value reaching `retrieveRelevantChunks`/the DB. Only `topK` has an upper-bound concept;
 *  `paperNumber` never passes a `max`. */
const MAX_TOP_K = 50;

/** Parses a query param as a strict positive plain-decimal integer (reusing
 *  `parsePaperNumberRouteSegment`'s "no hex/exponential/decimal-fraction/leading-plus"
 *  strictness), returning `undefined` for anything absent, malformed, non-positive -- never a
 *  crash (I/O Edge-Case Matrix). Used for both `topK` and `paperNumber`: an `undefined` result
 *  always means "let the caller apply its own default / no filter," never an error response.
 *
 *  When `max` is given (only `topK` passes one) and the parsed value exceeds it, the value is
 *  *clamped* down to `max` rather than falling back to `undefined`/the default -- a request for
 *  `?topK=999999` still gets a bounded, non-empty result (the maximum allowed), not silently the
 *  unrelated default of 5. */
function parsePositiveIntQueryParam(
  value: string | string[] | undefined,
  max?: number,
): number | undefined {
  const raw = firstQueryValue(value);
  if (raw === undefined) return undefined;
  const parsed = parsePaperNumberRouteSegment(raw);
  if (parsed === null || parsed <= 0) return undefined;
  if (max !== undefined && parsed > max) return max;
  return parsed;
}

/**
 * `GET /api/papers`, `GET /api/papers/search`, `GET /api/papers/search/semantic`, and
 * `GET /api/papers/:paperNumber` (global prefix set in main.ts). `apps/web` is this controller's
 * only consumer, over HTTP only (Structural Seed) -- it never reaches `libs/database` or
 * `libs/retrieval` directly.
 */
@Controller('papers')
export class PapersController {
  constructor(private readonly papersService: PapersService) {}

  /** Returns every ingested paper with author names, sorted by paperNumber (CAP-1, Story 1.3). */
  @Get()
  findAll(): Promise<PaperSummary[]> {
    return this.papersService.findAll();
  }

  /**
   * "Quick find" search by paper number, author, title, or keyword (Story 2.1) -- a direct
   * relational query against `libs/database`, never `libs/retrieval`. Declared *before*
   * `findOne`'s `@Get(':paperNumber')` below: Nest/Express matches routes in registration order,
   * and an unordered `:paperNumber` route would otherwise swallow `/papers/search` as though
   * "search" were itself a paperNumber (and 404, since it's non-numeric) before this handler ever
   * ran. A missing/blank `q` returns an empty array -- this endpoint only searches; deciding that
   * "no search term" means "show the unfiltered list instead" is `apps/web`'s page-level concern,
   * which is why it never calls this endpoint with a blank `q` in the first place.
   *
   * A repeated `?q=a&q=b` resolves `q` to `string[]` (Nest/Express's normal behavior for a
   * repeated query param) -- only the first value is ever meaningful, same normalization
   * `apps/web/src/app/page.tsx` already applies to its own `searchParams.q`. Without this, the
   * array would reach `searchPapers`'s `query.trim()` unchanged and throw (`TypeError: query.trim
   * is not a function`), producing an unhandled 500 instead of a clean 200.
   */
  @Get('search')
  search(@Query('q') q?: string | string[]): Promise<PaperSummary[]> {
    const query = firstQueryValue(q) ?? '';
    return this.papersService.search(query);
  }

  /**
   * Semantic ("Ask-the-Archive"-precursor) search (Story 2.2) -- pure pass-through to
   * `libs/retrieval`'s `retrieveRelevantChunks`; no orchestration, generation, or citation logic
   * (that's Epic 3's job). Declared alongside `search` above: Nest/Express matches routes by
   * path shape, so this two-segment path (`/papers/search/semantic`) never collides with the
   * single-segment `:paperNumber` route below regardless of declaration order, but grouping it
   * next to `search` keeps every search-flavored route together for readers.
   *
   * `topK`/`paperNumber` are parsed with `parsePositiveIntQueryParam` -- an absent or malformed
   * value never crashes the request, it just means "use `retrieveRelevantChunks`'s own default
   * topK" / "apply no paperNumber filter." `topK` additionally clamps to `MAX_TOP_K` (50) so a
   * value like `?topK=999999` can never reach the SQL `LIMIT` unbounded; `paperNumber` has no
   * such upper-bound concept and is never clamped. A missing/blank `q` returns an empty array without
   * ever calling the embedding model, same empty-query contract `retrieveRelevantChunks` itself
   * guarantees. An embedding-call failure (e.g. a missing `GEMINI_API_KEY`) rejects the returned
   * promise, which Nest's default exception filter turns into a clear 500 response rather than a
   * hang or an unhandled crash (I/O Edge-Case Matrix).
   */
  @Get('search/semantic')
  searchSemantic(
    @Query('q') q?: string | string[],
    @Query('topK') topK?: string | string[],
    @Query('paperNumber') paperNumber?: string | string[],
    @Query('author') author?: string | string[],
  ): Promise<RetrievedChunk[]> {
    const query = firstQueryValue(q) ?? '';
    const parsedTopK = parsePositiveIntQueryParam(topK, MAX_TOP_K);
    const parsedPaperNumber = parsePositiveIntQueryParam(paperNumber);
    const parsedAuthor = firstQueryValue(author)?.trim();

    return this.papersService.searchSemantic(query, {
      ...(parsedTopK !== undefined ? { topK: parsedTopK } : {}),
      ...(parsedPaperNumber !== undefined ? { paperNumber: parsedPaperNumber } : {}),
      ...(parsedAuthor !== undefined && parsedAuthor.length > 0
        ? { author: parsedAuthor }
        : {}),
    });
  }

  /**
   * Returns one paper's full detail for the Paper Reader (Story 1.4). A non-numeric route
   * segment (e.g. `/papers/abc`, or `Number()`-lenient lookalikes like `/papers/0x10`,
   * `/papers/1e2`, `/papers/1.0`) is treated the same as a nonexistent paper number -- both are
   * "no such paper," not a crash-worthy input error -- so both produce a plain 404.
   */
  @Get(':paperNumber')
  async findOne(@Param('paperNumber') paperNumber: string): Promise<PaperDetail> {
    const parsed = parsePaperNumberRouteSegment(paperNumber);
    if (parsed === null) {
      throw new NotFoundException();
    }

    const detail = await this.papersService.findOne(parsed);
    if (!detail) {
      throw new NotFoundException();
    }

    return detail;
  }
}
