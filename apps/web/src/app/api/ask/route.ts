import { ASK_FETCH_TIMEOUT_MS, resolveApiBaseUrl } from '@/lib/api-client';

/**
 * Proxies the "Ask the Archive" client component's `POST` to apps/api's real
 * `POST /api/ask` (Story 3.1). apps/web never accesses the database or the AI provider directly
 * (Structural Seed) -- this route handler exists purely so `API_BASE_URL` stays a server-side-only
 * value (never `NEXT_PUBLIC_`-prefixed, matching every other apps/web -> apps/api call in this
 * codebase) while still letting the client component make an interactive, loading-state-aware
 * request rather than a full-page form GET (which is how `QuickFindSearch`, Story 2.1, gets away
 * with calling apps/api only from a Server Component).
 *
 * A thin, mostly-transparent passthrough: apps/api's own status code and JSON body (including a
 * 400 for a blank question, or the full `Answer` shape on success) are forwarded unchanged. Only
 * apps/api being genuinely unreachable, timing out, or this route receiving an unparsable request
 * body are handled here directly.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ message: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const baseUrl = resolveApiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ASK_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    // apps/api being unreachable, down, or too slow must never hang this route or crash the
    // client component -- mirrors the Browse Papers/Paper Reader pages' identical
    // "API unreachable" handling (I/O matrix), just from a route handler instead of a Server
    // Component.
    console.error('Failed to reach apps/api for POST /ask:', err);
    return Response.json(
      { message: "We couldn't reach the Federalist Research server. Please try again shortly." },
      { status: 502 },
    );
  }

  const responseBody: unknown = await response.json().catch(() => null);
  return Response.json(responseBody, { status: response.status });
}
