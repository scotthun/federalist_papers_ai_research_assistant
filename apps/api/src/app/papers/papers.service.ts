import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { findAllPapersForBrowse } from '@federalist-research/database';
import { PaperSummary } from '@federalist-research/shared';
import { DataSource } from 'typeorm';

/**
 * Backs `GET /api/papers` (CAP-1, Browse Papers). Thin by design (AD-8's orchestration-lives-
 * in-apps/api pattern generalizes here too) -- the only real work is the read-only query in
 * `libs/database`; this just adapts its row shape to the `PaperSummary` response contract.
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
}
