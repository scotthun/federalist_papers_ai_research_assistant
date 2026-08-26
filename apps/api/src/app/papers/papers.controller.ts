import { Controller, Get } from '@nestjs/common';
import { PaperSummary } from '@federalist-research/shared';
import { PapersService } from './papers.service';

/**
 * `GET /api/papers` (global prefix set in main.ts) -- returns every ingested paper with author
 * names, sorted by paperNumber (CAP-1, Story 1.3). `apps/web` is this endpoint's only consumer,
 * over HTTP only (Structural Seed) -- it never reaches `libs/database` directly.
 */
@Controller('papers')
export class PapersController {
  constructor(private readonly papersService: PapersService) {}

  @Get()
  findAll(): Promise<PaperSummary[]> {
    return this.papersService.findAll();
  }
}
