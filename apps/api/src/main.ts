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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
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
