import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { InitSchema1787627139314 } from '../migrations/1787627139314-InitSchema';
import { Author } from './entities/author.entity';
import { DocumentChunk } from './entities/document-chunk.entity';
import { FederalistPaper } from './entities/federalist-paper.entity';

export const databaseEntities = [FederalistPaper, Author, DocumentChunk];

// Migrations are passed as direct class references, not a glob path -- glob-based discovery
// only works against a real migrations/*.js directory on disk, which doesn't exist once the
// migrate/ingest Nx targets bundle this into a single file. Direct references work identically
// whether resolved via ts-jest, ts-node, or a webpack bundle.
export const databaseMigrations = [InitSchema1787627139314];

/**
 * Shared TypeORM wiring for `databaseUrl` -- used by both apps/api's running NestJS process
 * (via TypeOrmModule.forRootAsync) and the standalone migrate/ingest Nx targets, so the running
 * app and the migration runner can never drift on which entities/migrations exist.
 */
export function createDataSourceOptions(
  databaseUrl: string,
): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl,
    entities: databaseEntities,
    migrations: databaseMigrations,
    synchronize: false,
    // Neon's PgBouncer already pools underneath -- a modest per-instance pool avoids stacking
    // many small pools against the shared pooled endpoint under Fluid compute's concurrent
    // warm-instance model (Story 4.1).
    extra: { max: 5 },
  };
}

export function createDataSource(databaseUrl: string): DataSource {
  return new DataSource(createDataSourceOptions(databaseUrl));
}
