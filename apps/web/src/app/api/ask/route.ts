import { AnswerSchema } from '@federalist-research/shared';
import { ASK_FETCH_TIMEOUT_MS, resolveApiBaseUrl } from '@/lib/api-client';
import {
  ASK_STREAM_TOKEN_DELAY_MS,
  chunkIntoWords,
  serializeAskStreamEvent,
} from '@/lib/ask-stream';

const UNREACHABLE_ERROR_BODY = {
  message: "We couldn't reach the Federalist Research server. Please try again shortly.",
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Relays the "Ask the Archive" quill panel's `POST` to apps/api's real `POST /api/ask`
 * (Story 3.1), then streams the result back to the browser as NDJSON (Story 5.1) -- apps/api's
 * `AskController`/`AskService`/citation verification are unmodified and still resolve the full
 * answer synchronously in one call; this route only adds a client-perceived streaming layer on
 * top of the already-complete, already-verified response. apps/web never accesses the database or
 * the AI provider directly (Structural Seed) -- this route handler exists purely so
 * `API_BASE_URL` stays a server-side-only value (never `NEXT_PUBLIC_`-prefixed).
 *
 * Non-2xx/unreachable/malformed-JSON paths are unchanged from the pre-streaming version: apps/api's
 * own status code and JSON body (e.g. a 400 for a blank question) are forwarded unchanged, and a
 * genuinely unreachable/timed-out apps/api still returns the same plain 502 JSON error -- no
 * streaming is ever attempted for an error response (this story's I/O matrix).
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
    return Response.json(UNREACHABLE_ERROR_BODY, { status: 502 });
  }

  const responseBody: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // apps/api's own non-2xx status and body (e.g. 400 for a blank question) are forwarded
    // unchanged -- never streamed.
    return Response.json(responseBody, { status: response.status });
  }

  const parsedAnswer = AnswerSchema.safeParse(responseBody);
  if (!parsedAnswer.success) {
    // apps/api already verifies its own output before this route ever sees it, so this should
    // never happen in practice -- but a malformed 2xx body must still fail the same way an
    // unreachable API does, rather than starting a stream around invalid data.
    console.error('apps/api returned a 2xx body that failed Answer validation for POST /ask');
    return Response.json(UNREACHABLE_ERROR_BODY, { status: 502 });
  }

  const answer = parsedAnswer.data;

  // Flipped by `cancel()` below if the client (the quill panel) aborts mid-stream -- panel
  // closed/unmounted, or the browser tab navigated away -- so the word-delay loop stops
  // enqueuing rather than calling `controller.enqueue()`/`controller.close()` on a controller
  // whose stream has already been cancelled, which would throw.
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      // Only the confident tier reveals token-by-token (this story's Boundaries) -- clarify/refuse
      // renders instantly via a single `done` event with no preceding `token` events. `'medium'`
      // is schema-valid (`libs/shared/src/lib/answer.ts`) but never produced by any tier in
      // `AskService`'s current confidence logic, so this binary high/not-high branch is
      // intentional, not an oversight that forgot a third case.
      if (answer.confidence === 'high') {
        for (const word of chunkIntoWords(answer.answer)) {
          if (cancelled) {
            return;
          }
          controller.enqueue(
            encoder.encode(serializeAskStreamEvent({ type: 'token', text: word })),
          );
          await delay(ASK_STREAM_TOKEN_DELAY_MS);
        }
      }

      if (cancelled) {
        return;
      }
      controller.enqueue(
        encoder.encode(
          serializeAskStreamEvent({
            type: 'done',
            answer: answer.answer,
            citations: answer.citations,
            confidence: answer.confidence,
            insufficientEvidence: answer.insufficientEvidence,
          }),
        ),
      );
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  });
}
