import type { RetrievedChunk } from './db.js';
import type { GroundedAnswer } from './ai.js';
import { verifyCitations } from './verify-citations.js';

export interface AnswerResult {
  answer: string;
  citations: GroundedAnswer['citations'];
  insufficientEvidence: boolean;
}

type GenerateFn = (question: string, context: RetrievedChunk[]) => Promise<GroundedAnswer>;

const INSUFFICIENT_EVIDENCE_MESSAGE =
  "I couldn't find sufficient evidence in the Federalist Papers to answer that confidently.";

// Retry-then-fail-safe policy (decisions.md, "Citation verification"): a fabricated
// chunkId gets one corrected retry; if that also fails, fall back to the honest
// insufficient-evidence response rather than silently stripping the bad citation
// and serving the rest of the answer as if it were still fully verified.
export async function answerWithVerification(
  question: string,
  context: RetrievedChunk[],
  generate: GenerateFn,
): Promise<AnswerResult> {
  const retrievedChunkIds = new Set(context.map((c) => c.chunkId));

  const first = await generate(question, context);
  const firstCheck = verifyCitations(first.citations, retrievedChunkIds);
  if (firstCheck.valid) {
    return { answer: first.answer, citations: first.citations, insufficientEvidence: false };
  }

  const retryContext: RetrievedChunk[] = [
    ...context,
    {
      chunkId: -1,
      paperId: -1,
      paperNumber: -1,
      paperTitle: '',
      sourceUrl: '',
      score: 0,
      content: `CORRECTION: chunkId(s) ${firstCheck.invalidChunkIds.join(', ')} do not exist in the retrieved context. Valid chunkId values are: ${[...retrievedChunkIds].join(', ')}. Use only those.`,
    },
  ];
  const retry = await generate(question, retryContext);
  const retryCheck = verifyCitations(retry.citations, retrievedChunkIds);
  if (retryCheck.valid) {
    return { answer: retry.answer, citations: retry.citations, insufficientEvidence: false };
  }

  return { answer: INSUFFICIENT_EVIDENCE_MESSAGE, citations: [], insufficientEvidence: true };
}
