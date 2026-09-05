import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { EmbeddingProvider } from '@federalist-research/ai';
import {
  findAllPapersForBrowse,
  findPaperDetailByNumber,
  searchPapers,
} from '@federalist-research/database';
import {
  retrieveRelevantChunks,
  type RetrievedChunk,
  type RetrieveOptions,
} from '@federalist-research/retrieval';
import { PaperDetail, PaperSummary } from '@federalist-research/shared';
import { DataSource } from 'typeorm';
import { EMBEDDING_PROVIDER } from '../ai-provider.provider';

/**
 * Backs `GET /api/papers` (CAP-1, Browse Papers), `GET /api/papers/search` (Story 2.1, "Quick
 * find"), `GET /api/papers/search/semantic` (Story 2.2, semantic search), and
 * `GET /api/papers/:paperNumber` (Paper Reader, Story 1.4). Thin by design (AD-8's
 * orchestration-lives-in-apps/api pattern generalizes here too) -- the only real work is the
 * read-only queries in `libs/database`/`libs/retrieval`; this just adapts their row shapes to
 * the response contracts (or, for semantic search, passes `libs/retrieval`'s own
 * `RetrievedChunk[]` straight through -- no orchestration, generation, or citation logic, that's
 * Epic 3's job).
 */
@Injectable()
export class PapersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
  ) {}

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

  /**
   * Pure pass-through to `libs/retrieval`'s `retrieveRelevantChunks` -- no confidence-threshold
   * interpretation, citation logic, or answer generation (Story 2.2's Boundaries; that's Epic
   * 3's orchestrator). A missing/invalid AI provider config (e.g. no `GEMINI_API_KEY`) surfaces
   * as a rejected promise here -- Nest's default exception filter turns that into a clear 500
   * response rather than a hang or an unhandled crash (I/O Edge-Case Matrix).
   */
  searchSemantic(query: string, options: RetrieveOptions): Promise<RetrievedChunk[]> {
    return retrieveRelevantChunks(this.dataSource, this.embeddingProvider, query, options);
  }
}
