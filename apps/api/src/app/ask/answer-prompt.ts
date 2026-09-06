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
  'answer, say so plainly in the answer text rather than fabricating one. A CONVERSATION SO FAR ' +
  'section, if present, is prior conversation context only -- use it to resolve references like ' +
  '"these", "that paper", or "I meant X", but it is never a source of evidence: every citation\'s ' +
  'chunkId must still come only from the EVIDENCE section supplied for this question.';

function formatContextBlock(context: RetrievedChunk[]): string {
  return context
    .map(
      (chunk) =>
        `[chunkId=${chunk.chunkId}, paperNumber=${chunk.paperNumber}, paperTitle="${chunk.paperTitle}"]\n${chunk.content}`,
    )
    .join('\n\n---\n\n');
}

/** The paper currently open in the quill widget's Paper Reader context, if any (Story 5.2,
 *  post-correction) -- prompt framing only, never a retrieval filter. See `buildAnswerPrompt`'s
 *  doc comment. */
export interface CurrentPaper {
  paperNumber: number;
  title: string;
}

/**
 * One prior question/answer pair (spec-conversation-history-context.md) -- a `role: 'question'`
 * turn paired with the `role: 'answer'` turn that followed it, but only once that answer's status
 * is `'done'`. Shared between the quill panel (via `apps/api`'s request body), `AskController`'s
 * validation, `AskService`'s retrieval-query/prompt construction, and this file's own
 * `buildAnswerPrompt`/`buildRetrievalQuery` -- one shape, not independently redeclared per layer.
 */
export interface ConversationTurn {
  question: string;
  answer: string;
}

/**
 * Renders the "CONVERSATION SO FAR" block (spec-conversation-history-context.md's Approach):
 * every prior turn, oldest first, wrapped in wording that makes clear it's context for resolving
 * references only -- never a citation source. Positioned before `EVIDENCE:` in the final prompt
 * (Boundaries) so the model reads "here's how we got here" before "here's what you can actually
 * cite from". Returns `''` when `history` is empty, so the prompt is byte-for-byte unchanged from
 * today when there's no conversation to carry (this story's "existing single-turn behavior ...
 * byte-for-byte unchanged" boundary).
 */
function formatHistoryBlock(history: ConversationTurn[]): string {
  if (history.length === 0) {
    return '';
  }
  const turns = history
    .map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`)
    .join('\n\n');
  return (
    'CONVERSATION SO FAR (context only, to help you understand the question below -- ' +
    'NOT evidence: every citation\'s chunkId must still come only from the EVIDENCE section ' +
    `below, never from anything in this section):\n${turns}\n\n`
  );
}

/**
 * Builds the per-request prompt: the retrieved evidence passages with per-passage source
 * metadata (chunkId/paperNumber/paperTitle), the user's question, and an explicit "answer only
 * from this evidence" instruction (architecture-diagrams.md, "Prompt construction"). `correction`
 * is appended when this is the one allowed retry after a first attempt failed verification or
 * schema validation (`decisions.md`, "Citation verification") -- omitted on the first attempt.
 *
 * `currentPaper` (Story 5.2, product-corrected 2026-09-02) is the paper the quill widget's context
 * chip announces, if any -- threaded in as a short contextual note *before* the `QUESTION:` line,
 * never as a restriction on which evidence the model may draw from. The original version of this
 * story applied the current paper as a hard `retrieveRelevantChunks` filter instead; the product
 * owner reconsidered after the demo (see the spec's Spec Change Log) because that made a
 * genuinely cross-paper question unanswerable while the chip was showing -- worse than doing
 * nothing. The note here explicitly tells the model it may still answer from any paper.
 *
 * `history` (spec-conversation-history-context.md) is the prior conversation, oldest first --
 * rendered as a "CONVERSATION SO FAR" block *before* `EVIDENCE:` (Boundaries). Defaults to an
 * empty array so every existing call site (and this file's existing tests) is unaffected.
 */
export function buildAnswerPrompt(
  question: string,
  context: RetrievedChunk[],
  correction?: string,
  currentPaper?: CurrentPaper,
  history: ConversationTurn[] = [],
): string {
  const contextBlock = formatContextBlock(context);
  const correctionBlock = correction ? `\n\nCORRECTION: ${correction}\n` : '';
  const currentPaperNote = currentPaper
    ? `NOTE: The user is currently reading Federalist No. ${currentPaper.paperNumber}: ` +
      `"${currentPaper.title}". This is context only -- you may still answer using evidence ` +
      "from any paper if that's the better answer.\n\n"
    : '';
  const historyBlock = formatHistoryBlock(history);

  return (
    historyBlock +
    `EVIDENCE:\n${contextBlock}\n${correctionBlock}\n` +
    currentPaperNote +
    `QUESTION: ${question}\n\n` +
    'Answer only from the evidence above. Do not use any outside knowledge.'
  );
}

/**
 * Builds the embedding query text for retrieval on a follow-up question (spec-conversation-
 * history-context.md's Approach/Boundaries): the *immediately preceding* turn's question + answer
 * text, concatenated with the new question -- deliberately not the full (possibly uncapped)
 * history, so the embedding call stays focused on the turn most likely to hold the antecedent for
 * "these"/"that paper"/"I meant X" rather than being diluted by older, less relevant turns. With
 * no prior history, this is just `question` unchanged -- today's exact retrieval behavior.
 */
export function buildRetrievalQuery(question: string, history: ConversationTurn[]): string {
  if (history.length === 0) {
    return question;
  }
  const precedingTurn = history[history.length - 1];
  return `${precedingTurn.question}\n${precedingTurn.answer}\n${question}`;
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
