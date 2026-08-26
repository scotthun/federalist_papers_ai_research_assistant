import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  findAllPapersForBrowse,
  findPaperDetailByNumber,
  searchPapers,
} from '@federalist-research/database';
import { PaperDetail, PaperSummary } from '@federalist-research/shared';
import { DataSource } from 'typeorm';

/**
 * Backs `GET /api/papers` (CAP-1, Browse Papers), `GET /api/papers/search` (Story 2.1, "Quick
 * find"), and `GET /api/papers/:paperNumber` (Paper Reader, Story 1.4). Thin by design (AD-8's
 * orchestration-lives-in-apps/api pattern generalizes here too) -- the only real work is the
 * read-only queries in `libs/database`; this just adapts their row shapes to the
 * `PaperSummary`/`PaperDetail` response contracts.
 */
@Injectable()
export class PapersService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findAll(): Promise<PaperSummary[]> {
    const rows = await findAllPapersForBrowse(this.dataSource);
    return rows.map((row) => ({
      paperNumber: row.paperNumber,
      title: row.title,
      authors: row.authorNames,
    }));
  }

  async search(query: string): Promise<PaperSummary[]> {
    const rows = await searchPapers(this.dataSource, query);
    return rows.map((row) => ({
      paperNumber: row.paperNumber,
      title: row.title,
      authors: row.authorNames,
    }));
  }

  async findOne(paperNumber: number): Promise<PaperDetail | null> {
    const row = await findPaperDetailByNumber(this.dataSource, paperNumber);
    if (!row) {
      return null;
    }

    return {
      paperNumber: row.paperNumber,
      title: row.title,
      authors: row.authorNames,
      fullText: row.fullText,
      sourceUrl: row.sourceUrl,
    };
  }
}
