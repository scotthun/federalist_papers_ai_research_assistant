// Shared apps/web -> apps/api HTTP fetch plumbing. Both the Browse Papers page (Story 1.3) and
// the Paper Reader page (Story 1.4) need the identical base-URL resolution, trailing-slash
// handling, and request timeout -- centralized here so the two (and whatever Epic 3 adds next)
// can't drift into hand-duplicated copies of the same logic.

// apps/web never accesses the database directly (Structural Seed) -- every read goes through
// apps/api's HTTP endpoints. This default matches apps/api's own default port (3333, Story 1.3);
// API_BASE_URL overrides it (see apps/web/.env.example). Deliberately not NEXT_PUBLIC_-prefixed:
// this value is only ever read inside Server Components that never run in the browser, so it
// doesn't need (and shouldn't opt into) client-bundle inlining.
const DEFAULT_API_BASE_URL = 'http://localhost:3333/api';

// Unbounded external calls can hang (Story 1.2's ingest.ts hit the same class of problem and
// added an AbortController timeout for the same reason) -- a timeout here just surfaces through
// the same fetch-failure error path as any other failed request.
export const API_FETCH_TIMEOUT_MS = 5_000;

// POST /api/ask (Story 3.1) can involve a real LLM call -- and, on a citation-verification
// miss or malformed output, a second one for the one allowed retry -- so it needs a much longer
// timeout than the plain DB-read endpoints above use. Applied by
// apps/web/src/app/api/ask/route.ts, the Next.js route handler that proxies a client-side
// question to apps/api's real POST /api/ask (kept server-side so API_BASE_URL never has to become
// a browser-exposed NEXT_PUBLIC_ value).
export const ASK_FETCH_TIMEOUT_MS = 30_000;

/**
 * Resolves apps/api's configured base URL, with any trailing slash(es) stripped so an
 * operator-supplied value ending in "/" (e.g. "http://localhost:3333/api/") doesn't produce a
 * double slash once a path is appended.
 */
export function resolveApiBaseUrl(): string {
  const configuredBaseUrl = process.env.API_BASE_URL || DEFAULT_API_BASE_URL;
  return configuredBaseUrl.replace(/\/+$/, '');
}
