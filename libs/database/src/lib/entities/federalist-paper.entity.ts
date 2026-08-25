import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Author } from './author.entity';
import { DocumentChunk } from './document-chunk.entity';

/**
 * One Federalist Paper, keyed for ingestion idempotency by `paperNumber` (NFR7, decisions.md).
 *
 * Authorship is a plain @ManyToMany with an auto-managed join table (never a string/array
 * column) so joint/disputed authorship (Nos. 18-20: Hamilton/Madison; Nos. 62-63: long-disputed
 * between the two) is represented correctly instead of forcing an arbitrary single pick or an
 * unqueryable value like "Hamilton or Madison" (data-model.md, "Authorship modeling").
 */
@Entity({ name: 'federalist_papers' })
@Unique('federalist_papers_paper_number_uq', ['paperNumber'])
export class FederalistPaper {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'paper_number', type: 'int' })
  paperNumber!: number;

  @Column({ type: 'text' })
  title!: string;

  // Avalon's bylines ("For the Independent Journal.", "From the New York Packet. Friday,
  // February 8, 1788.") are free text, not parsed into a real date by this story -- the column
  // exists per data-model.md ("if available") for a future story to populate without a schema
  // change.
  @Column({ name: 'publication_date', type: 'date', nullable: true })
  publicationDate!: string | null;

  // Required, never optional -- the exact Avalon page this paper's text was ingested from,
  // shown to end users so they can independently verify it (decisions.md, "Source selection").
  @Column({ name: 'source_url', type: 'text' })
  sourceUrl!: string;

  @Column({ name: 'full_text', type: 'text' })
  fullText!: string;

  @ManyToMany(() => Author, (author) => author.papers)
  @JoinTable({
    name: 'federalist_paper_authors',
    joinColumn: { name: 'paper_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'author_id', referencedColumnName: 'id' },
  })
  authors!: Author[];

  @OneToMany(() => DocumentChunk, (chunk) => chunk.paper)
  chunks!: DocumentChunk[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
