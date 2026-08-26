import { z } from 'zod';

/**
 * One citation backing an `Answer` (Epic 3, "Ask the Archive"). The first real Zod schema in
 * `libs/shared` -- AD-9's shared-schema rule is scoped specifically to this `Answer`/`Citation`
 * contract (see `paper-detail.ts`'s doc comment) because, unlike `PaperSummary`/`PaperDetail`,
 * this data is genuinely uncertain: it's either straight from the LLM (confident tier) or a
 * code-generated best guess (clarify tier), never backend-controlled data with nothing to guard
 * against.
 *
 * `chunkId` is only ever meaningful for the one server-side verification round-trip within the
 * request that produced it (`decisions.md`, "Chunk ID lifetime") -- never a stable, bookmarkable,
 * or re-look-up-able identifier. `quotedPassage`/`relevanceExplanation` are optional: the clarify
 * tier's single best-guess citation deliberately omits both (an unproven guess, not a verified
 * source -- this story's Boundaries).
 */
export const CitationSchema = z.object({
  paperNumber: z.number(),
  paperTitle: z.string(),
  chunkId: z
    .string()
    .describe(
      'The exact chunkId value from the evidence passage being cited -- must exactly match ' +
        'one of the chunkId values shown in the evidence block. Never invent, guess, or reuse a ' +
        'chunkId from memory.',
    ),
  quotedPassage: z
    .string()
    .optional()
    .describe(
      "A short, direct quote copied verbatim from that citation's chunk content that backs " +
        'the specific claim it is cited for.',
    ),
  relevanceExplanation: z
    .string()
    .optional()
    .describe(
      'A brief explanation of why the quoted passage supports the specific claim in the ' +
        'answer.',
    ),
});

export type Citation = z.infer<typeof CitationSchema>;

/**
 * The *only* shape ever requested from or accepted out of the LLM's own output (this story's
 * Boundaries: "The LLM is only ever asked to produce `{ answer, citations }`"). `confidence` and
 * `insufficientEvidence` are never part of this schema -- they're always computed by the
 * `apps/api` orchestrator from the retrieval similarity score and merged in afterward, never
 * requested from or trusted from the LLM's self-report, even defensively. `libs/ai`'s
 * `generateStructuredOutput` is called with exactly this schema for the confident tier.
 */
export const LlmAnswerOutputSchema = z.object({
  answer: z.string(),
  citations: z.array(CitationSchema),
});

export type LlmAnswerOutput = z.infer<typeof LlmAnswerOutputSchema>;

/**
 * The full response shape for `POST /api/ask` (architecture-diagrams.md, "Answer schema") --
 * single source of truth for both `apps/api` (produces it) and `apps/web` (consumes it).
 * `confidence`/`insufficientEvidence` are always derived from the retrieval score in code, never
 * from the LLM (`decisions.md`, "Confidence tiering"). `"medium"` is schema-valid but not
 * produced by any tier in this story -- see the spec's Design Notes for why that's a deliberate
 * simplification, not an oversight.
 */
export const AnswerSchema = LlmAnswerOutputSchema.extend({
  confidence: z.enum(['high', 'medium', 'low']),
  insufficientEvidence: z.boolean(),
});

export type Answer = z.infer<typeof AnswerSchema>;
