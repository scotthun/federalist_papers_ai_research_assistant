import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Logger } from '@nestjs/common';

/**
 * Walks up from `startDir` looking for `nx.json` (the workspace root marker), so `.env` lookup
 * below is correct regardless of whether the process was started from the repo root (`nx serve
 * api`) or from apps/api itself -- a plain cwd-relative path resolves differently in each case.
 */
function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, 'nx.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached the filesystem root without finding nx.json -- fall back to the original
      // starting directory rather than failing outright.
      return startDir;
    }
    dir = parent;
  }
}

/**
 * Local dev convenience only: loads a .env file into process.env if present. Colocated
 * apps/api/.env takes precedence over a repo-root .env. Production reads real environment
 * variables directly (AD-5) -- no .env file is expected or required there.
 *
 * Shared by main.ts (the HTTP server) and the migrate/ingest one-off Nx-target scripts, so all
 * three resolve local env the same way.
 */
export function loadLocalEnv(): void {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const envCandidates = [
    join(workspaceRoot, 'apps/api/.env'),
    join(workspaceRoot, '.env'),
  ];
  const envPath = envCandidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;

  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    Logger.warn(
      `Failed to load env file at ${envPath}: ${(err as Error).message}. Continuing without it -- relying on process.env as already set.`,
    );
  }
}
