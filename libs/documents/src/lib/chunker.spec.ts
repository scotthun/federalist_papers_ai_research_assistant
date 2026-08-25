import { chunkText, DEFAULT_CHUNK_OPTIONS } from './chunker';

function words(n: number, word = 'word'): string {
  return Array.from({ length: n }, () => word).join(' ');
}

describe('chunkText', () => {
  it('groups multiple short paragraphs into a single chunk under the target size', () => {
    const text = [
      words(50, 'alpha'),
      words(50, 'beta'),
      words(50, 'gamma'),
    ].join('\n\n');
    const chunks = chunkText(text, { targetWords: 750, maxWords: 1000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('alpha');
    expect(chunks[0]).toContain('gamma');
  });

  it('starts a new chunk once the target size would be exceeded', () => {
    const text = [
      words(400, 'alpha'),
      words(400, 'beta'),
      words(400, 'gamma'),
    ].join('\n\n');
    const chunks = chunkText(text, { targetWords: 750, maxWords: 1000 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // no chunk should silently drop content
    expect(chunks.join(' ')).toContain('alpha');
    expect(chunks.join(' ')).toContain('beta');
    expect(chunks.join(' ')).toContain('gamma');
  });

  it('never splits a paragraph across chunks when the paragraph itself fits under maxWords', () => {
    const para = words(900, 'solid');
    const text = [words(200, 'before'), para, words(200, 'after')].join('\n\n');
    const chunks = chunkText(text, { targetWords: 750, maxWords: 1000 });
    const chunkContainingPara = chunks.find((c) => c.includes(para));
    expect(chunkContainingPara).toBeDefined();
  });

  it('falls back to splitting a single paragraph that alone exceeds maxWords', () => {
    const hugeParagraph = words(2500, 'huge');
    const chunks = chunkText(hugeParagraph, {
      targetWords: 750,
      maxWords: 1000,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.split(/\s+/).length).toBeLessThanOrEqual(1000);
    }
  });

  it('ignores empty paragraphs from stray blank lines', () => {
    const text = `${words(50)}\n\n\n\n${words(50, 'second')}`;
    const chunks = chunkText(text, { targetWords: 750, maxWords: 1000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].trim().length).toBeGreaterThan(0);
  });

  it('returns an empty array for empty input', () => {
    expect(chunkText('', { targetWords: 750, maxWords: 1000 })).toEqual([]);
    expect(
      chunkText('   \n\n  ', { targetWords: 750, maxWords: 1000 }),
    ).toEqual([]);
  });

  it('produces no overlap when overlapWords is 0 or omitted (spike-equivalent behavior)', () => {
    const text = [
      words(400, 'alpha'),
      words(400, 'beta'),
      words(400, 'gamma'),
    ].join('\n\n');
    const withZero = chunkText(text, {
      targetWords: 750,
      maxWords: 1000,
      overlapWords: 0,
    });
    const omitted = chunkText(text, { targetWords: 750, maxWords: 1000 });
    expect(withZero).toEqual(omitted);
    // "alpha" appears exactly 400 times in the source -- overlap would duplicate some of them
    // across a chunk boundary.
    const alphaCount = withZero
      .join(' ')
      .split(/\s+/)
      .filter((w) => w === 'alpha').length;
    expect(alphaCount).toBe(400);
  });

  it('carries trailing whole paragraphs forward as overlap into the next chunk', () => {
    const p1 = words(300, 'p1word');
    const p2 = words(300, 'p2word');
    const p3 = words(300, 'p3word');
    const p4 = words(300, 'p4word');
    const text = [p1, p2, p3, p4].join('\n\n');

    const chunks = chunkText(text, {
      targetWords: 500,
      maxWords: 700,
      overlapWords: 250,
    });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // every chunk after the first should open with the previous chunk's last paragraph
    for (let i = 1; i < chunks.length; i++) {
      const previousParagraphs = chunks[i - 1].split('\n\n');
      const lastOfPrevious = previousParagraphs[previousParagraphs.length - 1];
      expect(chunks[i].startsWith(lastOfPrevious)).toBe(true);
    }
    // and content is never lost
    expect(chunks.join(' ')).toContain('p1word');
    expect(chunks.join(' ')).toContain('p4word');
  });

  it('never lets carried-over overlap push a chunk past maxWords', () => {
    const p1 = words(900, 'big1');
    const p2 = words(900, 'big2');
    const text = [p1, p2].join('\n\n');

    const chunks = chunkText(text, {
      targetWords: 750,
      maxWords: 1000,
      overlapWords: 100,
    });

    for (const chunk of chunks) {
      expect(chunk.split(/\s+/).length).toBeLessThanOrEqual(1000);
    }
  });

  it('throws a clear error if overlapWords is not less than maxWords', () => {
    expect(() =>
      chunkText('some text', {
        targetWords: 750,
        maxWords: 1000,
        overlapWords: 1000,
      }),
    ).toThrow(/overlapWords.*maxWords/);
    expect(() =>
      chunkText('some text', {
        targetWords: 750,
        maxWords: 1000,
        overlapWords: 1500,
      }),
    ).toThrow(/overlapWords.*maxWords/);
  });

  it('exposes sane, spec-aligned defaults', () => {
    expect(DEFAULT_CHUNK_OPTIONS.targetWords).toBe(750);
    expect(DEFAULT_CHUNK_OPTIONS.maxWords).toBe(1000);
    expect(DEFAULT_CHUNK_OPTIONS.overlapWords).toBeGreaterThan(0);
  });
});
