import { describe, it, expect } from 'vitest';
import { verifyCitations } from '../src/verify-citations.js';

describe('verifyCitations', () => {
  it('accepts citations whose chunkId was actually retrieved', () => {
    const result = verifyCitations(
      [{ chunkId: 5, paperNumber: 51, quotedPassage: 'x' }],
      new Set([5, 6, 7]),
    );
    expect(result.valid).toBe(true);
    expect(result.invalidChunkIds).toEqual([]);
  });

  it('rejects a fabricated chunkId not in the retrieved set', () => {
    const result = verifyCitations(
      [{ chunkId: 999, paperNumber: 51, quotedPassage: 'x' }],
      new Set([5, 6, 7]),
    );
    expect(result.valid).toBe(false);
    expect(result.invalidChunkIds).toEqual([999]);
  });

  it('rejects when only some citations are fabricated', () => {
    const result = verifyCitations(
      [
        { chunkId: 5, paperNumber: 51, quotedPassage: 'real' },
        { chunkId: 42, paperNumber: 51, quotedPassage: 'fake' },
      ],
      new Set([5, 6, 7]),
    );
    expect(result.valid).toBe(false);
    expect(result.invalidChunkIds).toEqual([42]);
  });

  it('treats an answer with zero citations as invalid (nothing to verify against evidence)', () => {
    const result = verifyCitations([], new Set([5, 6, 7]));
    expect(result.valid).toBe(false);
  });
});
