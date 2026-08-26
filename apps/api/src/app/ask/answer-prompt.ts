import type { RetrievedChunk } from '@federalist-research/retrieval';

/**
 * Anti-hallucination system prompt (architecture-diagrams.md, "Prompt construction": "The system
 * prompt strongly discourages hallucination"). Framing/role instructions live here, separate from
 * the per-request `prompt` (question + evidence + any retry correction) built by
 * `buildAnswerPrompt` below -- `AIProvider.generateStructuredOutput` takes both as distinct
 * params.
 *
 * The model must never invent citations -- this instruction is the first line of defense, but
 * `verifyCitations`'s deterministic set-membership check is the actual enforcement mechanism
 * (`decisions.md`, "Citation verification": "not by prompt wording alone").
 */
export const ANSWER_SYSTEM_INSTRUCTION =
  'You are a careful research assistant answering questions about the Federalist Papers. ' +
  'Answer ONLY using the evidence passages supplied in the prompt -- never your own outside ' +
  'knowledge of the Federalist Papers, American history, or anything else. Every claim in your ' +
  "answer must be directly traceable to one of the supplied passages. Every citation's chunkId " +
  'must exactly match one of the chunkId values shown in the evidence -- never invent, guess, or ' +
  'reuse a chunkId from memory. For every citation you include, also provide quotedPassage (a ' +
  "short, direct quote copied verbatim from that citation's chunk content that backs the claim " +
  'you are citing it for) and relevanceExplanation (a brief explanation of why that quoted ' +
  'passage supports the specific claim). If the supplied evidence does not actually support an ' +
  'answer, say so plainly in the answer text rather than fabricating one.';

function formatContextBlock(context: RetrievedChunk[]): string {
  return context
    .map(
      (chunk) =>
        `[chunkId=${chunk.chunkId}, paperNumber=${chunk.paperNumber}, paperTitle="${chunk.paperTitle}"]\n${chunk.content}`,
    )
    .join('\n\n---\n\n');
}

/**
 * Builds the per-request prompt: the retrieved evidence passages with per-passage source
 * metadata (chunkId/paperNumber/paperTitle), the user's question, and an explicit "answer only
 * from this evidence" instruction (architecture-diagrams.md, "Prompt construction"). `correction`
 * is appended when this is the one allowed retry after a first attempt failed verification or
 * schema validation (`decisions.md`, "Citation verification") -- omitted on the first attempt.
 */
export function buildAnswerPrompt(
  question: string,
  context: RetrievedChunk[],
  correction?: string,
): string {
  const contextBlock = formatContextBlock(context);
  const correctionBlock = correction ? `\n\nCORRECTION: ${correction}\n` : '';

  return (
    `EVIDENCE:\n${contextBlock}\n${correctionBlock}\n` +
    `QUESTION: ${question}\n\n` +
    'Answer only from the evidence above. Do not use any outside knowledge.'
  );
}

/** Correction text for a retry triggered by `verifyCitations` catching a fabricated/mismatched
 *  `chunkId` -- names the invalid ID(s) and the full valid set (`decisions.md`, "Citation
 *  verification": "an explicit correction naming the invalid ID(s) and the full list of valid
 *  IDs"), never just silently dropped. */
export function buildInvalidCitationCorrection(
  invalidChunkIds: string[],
  validChunkIds: string[],
): string {
  return (
    `Your previous response cited chunkId(s) that do not exist in the evidence above: ` +
    `${invalidChunkIds.join(', ')}. The only valid chunkId values are: ${validChunkIds.join(', ')}. ` +
    'Respond again, citing only chunkId values from that valid list.'
  );
}

/** Correction text for a retry triggered by the confident tier's first response citing zero
 *  citations. Deliberately distinct from `buildInvalidCitationCorrection` -- that message assumes
 *  there's at least one fabricated `chunkId` to name; reusing it here (with an empty ID list)
 *  would produce a nonsensical retry prompt ("... do not exist in the evidence above: ." with no
 *  IDs named), the exact bug this function exists to fix. */
export function buildEmptyCitationsCorrection(): string {
  return (
    'Your previous response did not include any citations. You must cite at least one ' +
    'chunkId from the evidence above.'
  );
}

/** Correction text for a retry triggered by the LLM's first response failing to parse as JSON or
 *  failing `LlmAnswerOutputSchema` validation. */
export function buildInvalidOutputCorrection(errorMessage: string): string {
  return (
    `Your previous response could not be used: ${errorMessage}. ` +
    'Respond again with a result that matches the required shape exactly.'
  );
}
