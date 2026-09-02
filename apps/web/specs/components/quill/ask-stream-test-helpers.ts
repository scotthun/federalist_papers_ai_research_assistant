import { TextDecoder, TextEncoder } from 'node:util';
import {
  parseAskStreamEventLine,
  serializeAskStreamEvent,
  type AskStreamEvent,
} from '../../../src/lib/ask-stream';

// jest-environment-jsdom (unlike the `node` environment used by ask-route.spec.ts) does not
// provide `TextEncoder`/`TextDecoder` on its global scope (a known jsdom gap) -- polyfilled here
// so quill-panel.tsx's real `new TextDecoder()` stream-decoding runs under jsdom the same way it
// does in every real browser. Assigned once at module load, before any test renders a component
// that might call `new TextDecoder()`.
if (typeof (global as { TextEncoder?: unknown }).TextEncoder === 'undefined') {
  (global as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
}
if (typeof (global as { TextDecoder?: unknown }).TextDecoder === 'undefined') {
  (global as { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
}

/** A minimal `{ getReader() }` object satisfying exactly what `quill-panel.tsx` (and
 * `readAllAskStreamEvents` below) call on a streaming `Response.body` -- not a real
 * `ReadableStream` instance, which jsdom doesn't provide either. */
type FakeStreamBody = { getReader(): { read(): Promise<{ value?: Uint8Array; done: boolean }> } };

/**
 * Builds a fake streaming body that yields `events` one NDJSON-encoded chunk at a time, then
 * reports `done: true` -- shared by `mockAskFetchStream` (drives a component under test) and any
 * test that wants to read the same fixture directly via `readAllAskStreamEvents` (e.g. a sanity
 * check that the fixture itself is well-formed, independent of DOM assertions).
 *
 * Omitting a `done` event from `events` models this story's "stream ends without a done event"
 * scenario: the reader loop exhausts every chunk, `read()` then reports `done: true`, and the
 * panel treats that as a dropped connection.
 */
export function buildAskStreamBody(events: AskStreamEvent[]): FakeStreamBody {
  const encoder = new TextEncoder();
  const chunks = events.map((event) => encoder.encode(serializeAskStreamEvent(event)));
  let index = 0;

  return {
    getReader() {
      return {
        read: async () => {
          // A real macrotask tick between chunks (rather than an immediately-resolved promise)
          // so React actually commits an intermediate render between tokens -- without this, the
          // whole loop can resolve within one microtask flush and a test would never be able to
          // observe the "mid-stream" (cursor visible, partial text) state at all.
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (index < chunks.length) {
            const value = chunks[index];
            index += 1;
            return { value, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

/**
 * Reads every NDJSON line out of a streaming `Response`-shaped object's body into a parsed
 * `AskStreamEvent[]` -- the single shared implementation of "read the stream, split on `\n`,
 * buffer the trailing partial line, parse each line," used by both `ask-route.spec.ts` (reading
 * the real route handler's real `ReadableStream`) and this directory's specs (reading a fake
 * `buildAskStreamBody` fixture) so the two can't drift into hand-duplicated copies of the same
 * loop.
 */
export async function readAllAskStreamEvents(response: {
  body: FakeStreamBody | ReadableStream<Uint8Array> | null;
}): Promise<AskStreamEvent[]> {
  if (!response.body) {
    throw new Error('expected a streaming response body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: AskStreamEvent[] = [];
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      buffer += decoder.decode(value, { stream: true });
    }
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const event = parseAskStreamEventLine(line);
      if (event) events.push(event);
    }
  }

  return events;
}

/**
 * Mocks `global.fetch` to resolve with a streaming NDJSON body built from `events`. See
 * `buildAskStreamBody` for exactly what "streaming" means here (a fake `getReader()`, not a real
 * `ReadableStream`).
 */
export function mockAskFetchStream(events: AskStreamEvent[], init: { ok?: boolean } = {}) {
  const ok = init.ok ?? true;
  const body = buildAskStreamBody(events);

  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 502,
    body: ok ? body : undefined,
  }) as unknown as typeof fetch;
}

/** Models apps/api-unreachable-through-the-relay: `fetch` itself rejects. */
export function mockAskFetchRejects() {
  global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
}
