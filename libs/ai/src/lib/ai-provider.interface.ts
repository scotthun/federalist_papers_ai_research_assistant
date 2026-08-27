import type { ZodType } from 'zod';

/**
 * Adapter target interface every AI vendor SDK is adapted to (Adapter pattern -- stack.md's "AI
 * provider abstraction", decisions.md). No call site outside `libs/ai` ever imports a vendor SDK
 * directly; everything else depends only on this interface plus `createAIProvider()`
 * (ai-provider.factory.ts).
 *
 * `generateEmbedding()` was implemented first (Epic 1, ingestion). `generateStructuredOutput()`
 * (Epic 3, Ask-the-Archive) is the interface's generation half, added in Story 3.1 -- it collapses
 * the `generateAnswer`/`generateStructuredOutput` split this doc comment used to reserve for Epic
 * 3 into this one generic, schema-validated method; a caller that wants a grounded answer passes
 * `LlmAnswerOutputSchema` (`libs/shared`) as `schema`, but nothing about this method is
 * answer-specific.
 */
export interface AIProvider {
  /** Generates a single embedding vector for `text`. Dimension is provider/model-specific --
   *  callers that persist it (see libs/database's `document_chunks.embedding`) must already know
   *  which dimension they're pinned to. */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Generates a single structured-output response, validated against `schema` before it's ever
   * returned to the caller -- regardless of what schema hinting the underlying provider SDK
   * supports, that Zod validation is the real contract, not a formality (this story's
   * Boundaries). `systemInstruction` carries the anti-hallucination / role framing; `prompt`
   * carries the per-request question, evidence, and any retry correction. Rejects (never resolves
   * with a partially-valid or unvalidated value) if the provider's response can't be parsed as
   * JSON or doesn't satisfy `schema` even after one provider-side attempt -- callers that want a
   * corrected retry (e.g. this story's citation-verification retry policy) call this method again
   * themselves with a fresh prompt; this method never retries internally.
   */
  generateStructuredOutput<T>(params: {
    systemInstruction: string;
    prompt: string;
    schema: ZodType<T>;
  }): Promise<T>;
}
