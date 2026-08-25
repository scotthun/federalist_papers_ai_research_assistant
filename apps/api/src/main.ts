/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

/**
 * Walks up from `startDir` looking for `nx.json` (the workspace root
 * marker), so .env lookup below is correct regardless of whether the
 * process was started from the repo root (`nx serve api`) or from
 * apps/api itself (`nest start`) — a plain cwd-relative path resolves
 * differently in each case.
 */
function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'nx.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached the filesystem root without finding nx.json — fall back to
      // the original starting directory rather than failing outright.
      return startDir;
    }
    dir = parent;
  }
}

// Local dev convenience only: load a .env file into process.env if present.
// Colocated apps/api/.env takes precedence over a repo-root .env. Production
// reads real environment variables directly (AD-5) — no .env file is
// expected or required there.
const workspaceRoot = findWorkspaceRoot(process.cwd());
const envCandidates = [
  join(workspaceRoot, 'apps/api/.env'),
  join(workspaceRoot, '.env'),
];
const envPath = envCandidates.find((candidate) => existsSync(candidate));
if (envPath) {
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    Logger.warn(
      `Failed to load env file at ${envPath}: ${(err as Error).message}. Continuing without it — relying on process.env as already set.`,
    );
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap().catch((err) => {
  Logger.error(err);
  process.exit(1);
});
