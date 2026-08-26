import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import {
  PaperDetail,
  PaperSummary,
  parsePaperNumberRouteSegment,
} from '@federalist-research/shared';
import { PapersService } from './papers.service';

/**
 * `GET /api/papers` and `GET /api/papers/:paperNumber` (global prefix set in main.ts). `apps/web`
 * is this controller's only consumer, over HTTP only (Structural Seed) -- it never reaches
 * `libs/database` directly.
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
