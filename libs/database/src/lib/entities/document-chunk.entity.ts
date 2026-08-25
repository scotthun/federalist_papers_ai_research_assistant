import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { FederalistPaper } from './federalist-paper.entity';

/**
 * One paragraph-packed slice of a FederalistPaper's fullText, plus its embedding. `paperId` is
 * declared alongside the `paper` relation (both mapped to the same `paper_id` column) so
 * callers can filter/delete by paper without needing to load the relation -- see
 * paper-ingestion.repository.ts's delete-then-insert step.
 *
 * A `chunkId` (this row's `id`) is only ever meaningful within the request/response cycle that
 * produced it -- never a stable/shareable identifier (decisions.md, "Chunk ID lifetime";
 * enforcing that end-to-end is Epic 3's concern, not this story's).
 */
@Entity({ name: 'document_chunks' })
@Unique('document_chunks_paper_chunk_index_uq', ['paperId', 'chunkIndex'])
export class DocumentChunk {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('document_chunks_paper_id_idx')
  @Column({ name: 'paper_id', type: 'uuid' })
  paperId!: string;

  @ManyToOne(() => FederalistPaper, (paper) => paper.chunks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'paper_id' })
  paper!: FederalistPaper;

  @Column({ name: 'chunk_index', type: 'int' })
  chunkIndex!: number;

  @Column({ type: 'text' })
  content!: string;

  // Native pgvector column support (TypeORM 1.1.0's postgres driver): stored/read as a plain
  // number[] here, `vector(3072)` in Postgres. 3072 matches Gemini's gemini-embedding-001 --
  // changing the embedding model/dimension later is a deliberate, separately-costed migration
  // (decisions.md), not something this column tries to stay agnostic to.
  @Column({ type: 'vector', length: 3072 })
  embedding!: number[];

  // Optional citation-support metadata (data-model.md) -- Avalon doesn't expose page numbers or
  // sub-document headings, so these stay null for this story; the columns exist so a future,
  // better-annotated source doesn't need a schema change to populate them.
  @Column({ type: 'text', nullable: true })
  section!: string | null;

  @Column({ type: 'text', nullable: true })
  heading!: string | null;

  @Column({ name: 'page_number', type: 'int', nullable: true })
  pageNumber!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
