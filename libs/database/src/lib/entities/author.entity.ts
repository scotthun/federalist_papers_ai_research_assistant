import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { FederalistPaper } from './federalist-paper.entity';

/**
 * Kept deliberately minimal (name only) -- no bio/portrait/birth-year fields, since no
 * "About the Authors" feature is in scope today. A proper entity (rather than a string) makes
 * that decision cheap to add later, and gives joint/disputed authorship (see FederalistPaper) a
 * real home instead of an unqueryable string like "Hamilton or Madison" (data-model.md).
 */
@Entity({ name: 'authors' })
@Unique('authors_name_uq', ['name'])
export class Author {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @ManyToMany(() => FederalistPaper, (paper) => paper.authors)
  papers!: FederalistPaper[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
