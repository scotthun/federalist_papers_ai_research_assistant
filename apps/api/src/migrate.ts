/**
 * Entry point for the `api:migrate` Nx target (`npm run db:migrate`). Runs any pending TypeORM
 * migrations against DATABASE_URL. Not a Nest application -- just a one-off script, kept as thin
 * as main.ts's bootstrap.
 */
import { Logger } from '@nestjs/common';
import { createDataSource } from '@federalist-research/database';
import { validateEnv } from './app/env.validation';
import { loadLocalEnv } from './load-local-env';

async function main(): Promise<void> {
  loadLocalEnv();
  const { DATABASE_URL } = validateEnv();

  const dataSource = createDataSource(DATABASE_URL);
  await dataSource.initialize();

  try {
    const executed = await dataSource.runMigrations();
    if (executed.length === 0) {
      Logger.log(
        'No pending migrations -- schema already up to date.',
        'Migrate',
      );
    } else {
      for (const migration of executed) {
        Logger.log(`Applied migration: ${migration.name}`, 'Migrate');
      }
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  Logger.error(err, undefined, 'Migrate');
  process.exit(1);
});
