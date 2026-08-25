export interface ChunkOptions {
  targetWords: number;
  maxWords: number;
}

function wordCount(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

function splitOversizedParagraph(paragraph: string, maxWords: number): string[] {
  const words = paragraph.trim().split(/\s+/);
  const pieces: string[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    pieces.push(words.slice(i, i + maxWords).join(' '));
  }
  return pieces;
}

export function chunkText(text: string, opts: ChunkOptions): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join('\n\n'));
      current = [];
      currentWords = 0;
    }
  };

  for (const paragraph of paragraphs) {
    const pWords = wordCount(paragraph);

    if (pWords > opts.maxWords) {
      // A single paragraph too large to keep whole: flush what we have, then
      // fall back to a hard word-count split for this paragraph alone.
      flush();
      for (const piece of splitOversizedParagraph(paragraph, opts.maxWords)) {
        chunks.push(piece);
      }
      continue;
    }

    if (currentWords + pWords > opts.maxWords && current.length > 0) {
      flush();
    }

    current.push(paragraph);
    currentWords += pWords;

    if (currentWords >= opts.targetWords) {
      flush();
    }
  }
  flush();

  return chunks;
}
