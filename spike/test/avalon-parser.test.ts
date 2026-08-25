import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAvalonPaper } from '../src/avalon-parser.js';

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf-8');
}

describe('parseAvalonPaper', () => {
  it('parses a single-author paper (No. 1)', () => {
    const result = parseAvalonPaper(fixture('fed01.html'), 1);
    expect(result.paperNumber).toBe(1);
    expect(result.authors).toEqual(['HAMILTON']);
    expect(result.title).toMatch(/General Introduction/);
    expect(result.fullText).toMatch(/^To the People of the State of New York:/);
    expect(result.fullText).toMatch(/PUBLIUS\./);
    // footer nav text must not leak into the body
    expect(result.fullText).not.toMatch(/Next Document/);
    expect(result.fullText).not.toMatch(/Avalon Home/);
  });

  it('parses a single-author paper with a longer heading (No. 10)', () => {
    const result = parseAvalonPaper(fixture('fed10.html'), 10);
    expect(result.paperNumber).toBe(10);
    expect(result.authors).toEqual(['MADISON']);
    expect(result.title).toMatch(/Union as a Safeguard/);
    expect(result.fullText).toMatch(/AMONG the numerous advantages/);
  });

  it('parses a disputed-authorship paper (No. 51)', () => {
    const result = parseAvalonPaper(fixture('fed51.html'), 51);
    expect(result.paperNumber).toBe(51);
    expect(result.authors).toEqual(['HAMILTON', 'MADISON']);
    expect(result.title).toMatch(/Structure of the Government/);
    expect(result.fullText).toMatch(/Ambition must be made to counteract ambition/);
  });

  it('throws on content with no recognizable author', () => {
    expect(() => parseAvalonPaper('<html><body><p>no heading here</p></body></html>', 99)).toThrow();
  });
});
