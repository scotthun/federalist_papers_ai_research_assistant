import type { Citation } from './ai.js';

export interface VerificationResult {
  valid: boolean;
  invalidChunkIds: number[];
}

// Deterministic set-membership check, not an AI judgment call (decisions.md,
// "Citation verification") -- the caller already knows exactly which chunk IDs
// were retrieved, so this is a plain lookup, never a model call.
export function verifyCitations(citations: Citation[], retrievedChunkIds: Set<number>): VerificationResult {
  if (citations.length === 0) {
    return { valid: false, invalidChunkIds: [] };
  }
  const invalidChunkIds = citations.filter((c) => !retrievedChunkIds.has(c.chunkId)).map((c) => c.chunkId);
  return { valid: invalidChunkIds.length === 0, invalidChunkIds };
}
