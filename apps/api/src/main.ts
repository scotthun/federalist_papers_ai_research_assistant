/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { loadLocalEnv } from './load-local-env';

loadLocalEnv();

/**
 * Fails fast with a clear error rather than passing a possibly-invalid raw string to
 * `app.listen()` -- mirrors the validate-and-throw pattern `ingest.ts`'s `parseIntEnv` established
 * for this project's other operator-configurable numeric env vars (Story 1.2).
 */
export function parsePort(
  env: Record<string, string | undefined>,
  defaultValue: number,
): number {
  const raw = env.PORT;
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`PORT must be a positive integer, got "${raw}"`);
  }
  return value;
}

/**
 * `undefined` (local dev, `WEB_ORIGIN` unset, blank, or whitespace-only) means "don't call
 * `enableCors` at all" -- a byte-for-byte no-op, never a permissive/reflect-origin default
 * (Story 4.1's Boundaries & Constraints: "unset means no CORS call at all"). A literal `*` is
 * also treated as unset rather than passed through -- `enableCors({ origin: '*' })` would open
 * cross-origin access to every caller, exactly the permissive default this function's contract
 * forbids, not "restrict to that one origin only" (AD-1). A defined, non-`*` value restricts
 * cross-origin access to that one origin only.
 */
export function resolveCorsOrigin(
  env: Record<string, string | undefined>,
): string | undefined {
  const trimmed = env.WEB_ORIGIN?.trim();
  if (!trimmed || trimmed === '*') return undefined;
  return trimmed;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const corsOrigin = resolveCorsOrigin(process.env);
  if (corsOrigin) {
    app.enableCors({ origin: corsOrigin });
  }
  // Default moved off 3000 (Story 1.3) -- identical to Next.js's own dev-server default, and
  // apps/web + apps/api now run concurrently for real cross-app HTTP calls. Still overridable
  // via PORT.
  const port = parsePort(process.env, 3333);
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

// Guarded the same way ingest.ts guards its real run -- importing this module (e.g. main.spec.ts
// importing `parsePort`) must not itself trigger a real Nest bootstrap / DB connection attempt.
if (require.main === module) {
  bootstrap().catch((err) => {
    Logger.error(err);
    process.exit(1);
  });
}
