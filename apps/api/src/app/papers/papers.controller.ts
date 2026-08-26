import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import {
  PaperDetail,
  PaperSummary,
  parsePaperNumberRouteSegment,
} from '@federalist-research/shared';
import { PapersService } from './papers.service';

/**
 * `GET /api/papers`, `GET /api/papers/search`, and `GET /api/papers/:paperNumber` (global prefix
 * set in main.ts). `apps/web` is this controller's only consumer, over HTTP only (Structural
 * Seed) -- it never reaches `libs/database` directly.
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
    const query = Array.isArray(q) ? q[0] ?? '' : q ?? '';
    return this.papersService.search(query);
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
