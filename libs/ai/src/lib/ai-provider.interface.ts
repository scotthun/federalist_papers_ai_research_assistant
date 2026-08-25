/**
 * Adapter target interface every AI vendor SDK is adapted to (Adapter pattern -- stack.md's "AI
 * provider abstraction", decisions.md). No call site outside `libs/ai` ever imports a vendor SDK
 * directly; everything else depends only on this interface plus `createAIProvider()`
 * (ai-provider.factory.ts).
 *
 * Only `generateEmbedding()` is implemented in this story (Epic 1, ingestion). `generateAnswer()`
 * and `generateStructuredOutput()` are reserved for Epic 3 (Ask-the-Archive) and will be added to
 * this interface -- and to every existing adapter -- when that epic starts. Adding a method to an
 * already-adapted interface is not a breaking rewrite of the abstraction itself.
 */
export interface AIProvider {
  /** Generates a single embedding vector for `text`. Dimension is provider/model-specific --
   *  callers that persist it (see libs/database's `document_chunks.embedding`) must already know
   *  which dimension they're pinned to. */
  generateEmbedding(text: string): Promise<number[]>;
}
