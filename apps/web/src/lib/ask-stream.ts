import type { Answer } from '@federalist-research/shared';

// Shared NDJSON wire format between apps/web's own `/api/ask` route handler (the writer, once the
// underlying apps/api response is fully resolved and verified) and the quill panel (the reader) --
// centralized here so the two can never drift into hand-duplicated, silently-incompatible copies
// of the same shape (Story 5.1's Code Map). Deliberately not SSE/`EventSource`: this is a `POST`
// with a request body, which `EventSource` can't send.
//
// Confident tier (`confidence === 'high'`): zero or more `token` lines, each one word (with its
// trailing whitespace preserved) of the already-complete, already-verified answer text, followed
// by exactly one `done` line. Clarify/refuse tiers: just the one `done` line, no `token` lines --
// the panel renders instantly with no streaming cursor.
export type AskStreamEvent =
  | { type: 'token'; text: string }
  | {
      type: 'done';
      answer: string;
      citations: Answer['citations'];
      confidence: Answer['confidence'];
      insufficientEvidence: boolean;
    };

// A small artificial per-token delay so the confident-tier reveal reads as DESIGN.md's "measured,
// readable pace" rather than a flashy instantaneous blast -- small enough that it doesn't
// meaningfully slow down tests exercising a handful of words.
export const ASK_STREAM_TOKEN_DELAY_MS = 20;

/**
 * Splits already-complete answer text into word-sized chunks for the token-by-token reveal.
 * Every chunk after the first retains only its own *trailing* whitespace, but the leading
 * whitespace (if any) before the very first word is folded into that first chunk -- re-joining
 * every emitted chunk, in order, always reproduces the original text exactly, including any
 * leading whitespace, never silently dropping it.
 */
export function chunkIntoWords(text: string): string[] {
  const matches = text.match(/\s*\S+\s*/g);
  if (matches) {
    return matches;
  }
  // No `\S` anywhere -- either empty or entirely whitespace. Preserve whitespace-only text
  // verbatim as a single chunk (rather than silently dropping it) so the "reproduces the
  // original text exactly" guarantee above holds even for this edge case.
  return text.length > 0 ? [text] : [];
}

/** Serializes one event as a single NDJSON line (including the trailing newline). */
export function serializeAskStreamEvent(event: AskStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Parses one NDJSON line into an `AskStreamEvent`, or `null` for a blank or malformed line.
 * Callers should skip `null` results rather than throw: a stream can be split across arbitrary
 * chunk boundaries, so an incomplete trailing line is an expected, routine occurrence mid-stream,
 * never an error condition on its own.
 */
export function parseAskStreamEventLine(line: string): AskStreamEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const candidate = parsed as { type?: unknown };
  if (candidate.type === 'token' || candidate.type === 'done') {
    return parsed as AskStreamEvent;
  }

  return null;
}
