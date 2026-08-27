import type { Citation } from '@federalist-research/shared';
import { verifyCitations } from './verify-citations';

function citation(chunkId: string): Citation {
  return { paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId };
}

describe('verifyCitations', () => {
  it('is valid when every citation chunkId is in the retrieved set', () => {
    const retrievedChunkIds = new Set(['chunk-1', 'chunk-2', 'chunk-3']);

    const result = verifyCitations([citation('chunk-1'), citation('chunk-3')], retrievedChunkIds);

    expect(result.valid).toBe(true);
    expect(result.invalidChunkIds).toEqual([]);
  });

  // This is the load-bearing case the story's spec calls out explicitly: a fabricated chunkId
  // that was never part of the retrieved context must be caught, not waved through because it
  // merely looks well-formed. If this check were skipped, or checked against the wrong set (e.g.
  // "all chunk IDs that exist in the DB" instead of "the ones actually retrieved for this
  // request"), this test would fail to catch the fabrication and pass incorrectly.
  it('catches a fabricated chunkId that was never in the retrieved context', () => {
    const retrievedChunkIds = new Set(['chunk-1', 'chunk-2']);

    const result = verifyCitations(
      [citation('chunk-1'), citation('chunk-999-fabricated')],
      retrievedChunkIds,
    );

    expect(result.valid).toBe(false);
    expect(result.invalidChunkIds).toEqual(['chunk-999-fabricated']);
  });

  it('checks against the exact retrieved set for this request, not some other/wider set', () => {
    // A chunkId that is perfectly real (exists in some other request's retrieved set) but was
    // NOT part of *this* request's context must still be rejected -- proves the check is scoped
    // to the passed-in set, not to "any known chunkId anywhere".
    const retrievedChunkIds = new Set(['chunk-1']);

    const result = verifyCitations([citation('chunk-2')], retrievedChunkIds);

    expect(result.valid).toBe(false);
    expect(result.invalidChunkIds).toEqual(['chunk-2']);
  });

  it('collects every invalid chunkId, not just the first', () => {
    const retrievedChunkIds = new Set(['chunk-1']);

    const result = verifyCitations(
      [citation('chunk-2'), citation('chunk-1'), citation('chunk-3')],
      retrievedChunkIds,
    );

    expect(result.valid).toBe(false);
    expect(result.invalidChunkIds).toEqual(['chunk-2', 'chunk-3']);
  });

  // Guards against the retry-correction prompt (built from `invalidChunkIds`) repeating the same
  // bad ID verbatim -- e.g. "...do not exist in the evidence above: chunk-999, chunk-999." --
  // instead of naming it once.
  it('dedupes invalidChunkIds when the same invalid chunkId is cited more than once', () => {
    const retrievedChunkIds = new Set(['chunk-1']);

    const result = verifyCitations(
      [citation('chunk-999-fabricated'), citation('chunk-999-fabricated')],
      retrievedChunkIds,
    );

    expect(result.valid).toBe(false);
    expect(result.invalidChunkIds).toEqual(['chunk-999-fabricated']);
  });

  it('treats an empty citations array as invalid -- nothing was actually verified', () => {
    const retrievedChunkIds = new Set(['chunk-1']);

    const result = verifyCitations([], retrievedChunkIds);

    expect(result.valid).toBe(false);
    expect(result.invalidChunkIds).toEqual([]);
  });
});
