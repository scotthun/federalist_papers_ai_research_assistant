import type { Citation } from '@federalist-research/shared';

export interface CitationVerificationResult {
  valid: boolean;
  /** `chunkId`s cited by the LLM that were not among the actually-retrieved chunk IDs for this
   *  request -- the documented LLM failure mode this check exists to catch (`decisions.md`,
   *  "Citation verification": "the same category of error as lawyers submitting fabricated case
   *  citations from ChatGPT"). Deduplicated -- the same invalid `chunkId` cited more than once
   *  appears here only once, so the retry-correction prompt built from this list names each bad ID
   *  a single time rather than repeating it verbatim. Empty when `valid` is `true`. */
  invalidChunkIds: string[];
}

/**
 * Deterministic set-membership check, not an AI judgment call (`decisions.md`, "Citation
 * verification") -- `retrievedChunkIds` is exactly the set of chunk IDs actually sent to the LLM
 * as context for *this* request, so checking a returned citation's `chunkId` is a plain lookup,
 * never a model call. This is the real safety net against hallucinated sources -- it runs in
 * every tier that calls the LLM, not just as a courtesy.
 *
 * An empty `citations` array is also treated as invalid: the confident tier's whole point is a
 * *verified* grounded answer, and an answer with zero citations has nothing to verify -- treating
 * that the same as "verification passed" would let an ungrounded answer through as if it had been
 * checked. This triggers the same retry-then-fail-safe policy as a fabricated `chunkId`.
 */
export function verifyCitations(
  citations: Citation[],
  retrievedChunkIds: ReadonlySet<string>,
): CitationVerificationResult {
  if (citations.length === 0) {
    return { valid: false, invalidChunkIds: [] };
  }

  const invalidChunkIds = [
    ...new Set(
      citations
        .filter((citation) => !retrievedChunkIds.has(citation.chunkId))
        .map((citation) => citation.chunkId),
    ),
  ];

  return { valid: invalidChunkIds.length === 0, invalidChunkIds };
}
