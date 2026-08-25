export interface ChunkOptions {
  /** Soft target size, in words, of new content per chunk (words approximate tokens -- see the
   *  spec's Design Notes; "approximately 500-1,000 tokens" doesn't demand a real tokenizer). */
  targetWords: number;
  /** Hard ceiling, in words, a chunk (carried-over overlap included) never exceeds. */
  maxWords: number;
  /** Trailing words carried from the end of one chunk into the start of the next, for retrieval
   *  context continuity across a chunk boundary. 0 (the default) disables overlap entirely,
   *  matching the Story 0.1 spike's chunker. */
  overlapWords?: number;
}

/** Chunk size is configurable per `stack.md`, not hard-coded -- these are just sane defaults
 *  matching the spike's proven target/max, plus a modest overlap the spike didn't have. */
export const DEFAULT_CHUNK_OPTIONS: Required<ChunkOptions> = {
  targetWords: 750,
  maxWords: 1000,
  overlapWords: 100,
};

function wordCount(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

function wordsOf(text: string): string[] {
  return text.trim().split(/\s+/);
}

function splitOversizedParagraph(
  paragraph: string,
  maxWords: number,
  overlapWords: number,
): string[] {
  const words = wordsOf(paragraph);
  const step = Math.max(1, maxWords - overlapWords);
  const pieces: string[] = [];
  for (let i = 0; i < words.length; i += step) {
    pieces.push(words.slice(i, i + maxWords).join(' '));
    if (i + maxWords >= words.length) break;
  }
  return pieces;
}

/**
 * The trailing paragraphs of `paragraphs` whose combined word count is <= overlapWords, without
 * ever splitting an individual paragraph -- overlap is always whole paragraphs, consistent with
 * "never split mid-paragraph if avoidable" applying to the overlap too.
 */
function trailingOverlap(paragraphs: string[], overlapWords: number): string[] {
  if (overlapWords <= 0) return [];
  const result: string[] = [];
  let total = 0;
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const w = wordCount(paragraphs[i]);
    if (total > 0 && total + w > overlapWords) break;
    result.unshift(paragraphs[i]);
    total += w;
    if (total >= overlapWords) break;
  }
  return result;
}

/**
 * Splits `text` into chunks along paragraph boundaries, targeting ~`targetWords` of new content
 * per chunk and never exceeding `maxWords` total including any carried-over overlap
 * (`stack.md`'s chunking configuration). Never splits a paragraph across chunks unless that
 * single paragraph alone exceeds `maxWords`, in which case it's hard word-count split as a
 * fallback. No I/O -- pure text in, chunk strings out.
 */
export function chunkText(text: string, opts: ChunkOptions): string[] {
  const { targetWords, maxWords } = opts;
  const overlapWords = opts.overlapWords ?? 0;

  if (overlapWords >= maxWords) {
    // `splitOversizedParagraph`'s step size is `maxWords - overlapWords`, floored to 1 -- left
    // unvalidated, this degenerates into near-duplicate one-word-shifted pieces instead of a
    // clear error. `chunkText` accepts arbitrary caller-supplied options, so this can't rely on
    // `DEFAULT_CHUNK_OPTIONS` never triggering it.
    throw new Error(
      `overlapWords (${overlapWords}) must be less than maxWords (${maxWords})`,
    );
  }

  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let overlapWordCount = 0;
  let newWordCount = 0;
  let hasNew = false;

  const flush = () => {
    if (!hasNew) return;
    chunks.push(current.join('\n\n'));
    current = trailingOverlap(current, overlapWords);
    overlapWordCount = current.reduce((sum, p) => sum + wordCount(p), 0);
    newWordCount = 0;
    hasNew = false;
  };

  for (const paragraph of paragraphs) {
    const pWords = wordCount(paragraph);

    if (pWords > maxWords) {
      // A single paragraph too large to keep whole: flush what we have, then fall back to a
      // hard word-count split for this paragraph alone.
      flush();
      for (const piece of splitOversizedParagraph(
        paragraph,
        maxWords,
        overlapWords,
      )) {
        chunks.push(piece);
      }
      current = [];
      overlapWordCount = 0;
      newWordCount = 0;
      hasNew = false;
      continue;
    }

    if (hasNew && overlapWordCount + newWordCount + pWords > maxWords) {
      flush();
    }

    if (!hasNew && current.length > 0 && overlapWordCount + pWords > maxWords) {
      // The carried-over overlap alone, plus this paragraph, would already exceed maxWords --
      // drop the overlap this one time rather than violate the hard cap.
      current = [];
      overlapWordCount = 0;
    }

    current.push(paragraph);
    newWordCount += pWords;
    hasNew = true;

    if (newWordCount >= targetWords) {
      flush();
    }
  }
  flush();

  return chunks;
}
