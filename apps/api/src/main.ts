/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
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

/**
 * Split out from `bootstrap()` so Vercel's serverless entrypoint (`api/index.js`, Story 4.1
 * deploy walkthrough) can build the same configured Nest app without also binding a port --
 * Vercel's Node runtime owns the request lifecycle for a Function, not `app.listen()`.
 */
export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  const corsOrigin = resolveCorsOrigin(process.env);
  if (corsOrigin) {
    app.enableCors({ origin: corsOrigin });
  }
  // Same code path resolves `request.ip` correctly behind Vercel's proxy in production and the
  // local socket address in local dev -- no `isProd` branch (spec-4-2-rate-limiting-upstash.md,
  // AD-5). Express trusts the immediate proxy hop's `X-Forwarded-For` header; in local dev there
  // is no proxy, so `request.ip` still resolves to the direct socket address as before.
  app.set('trust proxy', 1);
  return app;
}

async function bootstrap() {
  const app = await createApp();
  // Default moved off 3000 (Story 1.3) -- identical to Next.js's own dev-server default, and
  // apps/web + apps/api now run concurrently for real cross-app HTTP calls. Still overridable
  // via PORT.
  const port = parsePort(process.env, 3333);
  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}/api`);
}

// Guarded the same way ingest.ts guards its real run -- importing this module (e.g. main.spec.ts
// importing `parsePort`) must not itself trigger a real Nest bootstrap / DB connection attempt.
//
// `require.main === module` alone isn't reliable inside Vercel's Function runtime (confirmed
// live, Story 4.1 deploy walkthrough): the webpack-bundled `dist/apps/api/main.js`, when
// `require()`'d by `api/[[...path]].js`'s serverless entrypoint, still satisfied this check and
// ran `bootstrap()` a second time on every request -- and since a Function has no `PORT` to bind
// (it was also an empty-string env var, so `parsePort` threw), the resulting rejection's
// `process.exit(1)` killed the entire Function instance mid-request, not just the errant listener.
// `process.env.VERCEL` is a Vercel-set system env var (undefined everywhere else), so it reliably
// suppresses the auto-listen path regardless of that require.main ambiguity.
if (require.main === module && !process.env.VERCEL) {
  bootstrap().catch((err) => {
    Logger.error(err);
    process.exit(1);
  });
}
