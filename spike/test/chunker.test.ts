import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/chunker.js';

function words(n: number, word = 'word'): string {
  return Array.from({ length: n }, () => word).join(' ');
}

describe('chunkText', () => {
  it('groups multiple short paragraphs into a single chunk under the target size', () => {
    const text = [words(50, 'alpha'), words(50, 'beta'), words(50, 'gamma')].join('\n\n');
    const chunks = chunkText(text, { targetWords: 750, maxWords: 1000 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('alpha');
    expect(chunks[0]).toContain('gamma');
  });

  it('starts a new chunk once the target size would be exceeded', () => {
    const text = [words(400, 'alpha'), words(400, 'beta'), words(400, 'gamma')].join('\n\n');
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
    const chunks = chunkText(hugeParagraph, { targetWords: 750, maxWords: 1000 });
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
    expect(chunkText('   \n\n  ', { targetWords: 750, maxWords: 1000 })).toEqual([]);
  });
});
