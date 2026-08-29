import { ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import type { ZodType } from 'zod';
import type { AIProvider } from '../ai-provider.interface';

// Verified live against the Gemini API (Story 0.1 spike, 2026-08-24): gemini-embedding-001
// returns 3072-dimensional embeddings by default. libs/database's `document_chunks.embedding`
// column is pinned to exactly this dimension -- changing it is a deliberate, separately-costed
// migration (decisions.md), not something this adapter should silently vary.
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSION = 3072;

// gemini-2.5-flash returns 404 for new API keys as of 2026-08 ("no longer available to new
// users"); the API's own error pointed at this replacement (Story 0.1 spike, confirmed live
// again for this story).
const GENERATION_MODEL = 'gemini-3.6-flash';

export interface GeminiProviderOptions {
  apiKey: string;
}

/** Concrete Adapter wrapping `@langchain/google-genai` behind the `AIProvider` interface -- the
 *  one initial provider (stack.md: "implement at least one provider initially"). LangChain.js is
 *  the architecture-mandated AI layer (ARCHITECTURE-SPINE.md); it is an implementation detail of
 *  this one adapter class, never imported by any consumer outside `libs/ai` (GH-24). */
export class GeminiProvider implements AIProvider {
  private readonly chatModel: ChatGoogleGenerativeAI;
  private readonly embeddings: GoogleGenerativeAIEmbeddings;

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey) {
      throw new Error('GeminiProvider requires a non-empty apiKey');
    }
    // maxRetries: 0 -- @langchain/core's AsyncCaller otherwise defaults to 6 silent internal
    // retries on transient errors, which would violate this method's "never retries internally
    // -- one model call per invocation" contract at runtime (the caller's own retry policy, e.g.
    // this story's citation-verification retry, is the only place a retry is allowed to happen).
    this.chatModel = new ChatGoogleGenerativeAI({
      model: GENERATION_MODEL,
      apiKey: options.apiKey,
      maxRetries: 0,
    });
    this.embeddings = new GoogleGenerativeAIEmbeddings({
      model: EMBEDDING_MODEL,
      apiKey: options.apiKey,
      maxRetries: 0,
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const values = await this.embeddings.embedQuery(text);
    if (!values || values.length === 0) {
      throw new Error('Gemini returned no embedding values');
    }
    // If Gemini ever changed gemini-embedding-001's default output dimensionality, this would
    // otherwise only surface much later as an opaque Postgres vector(3072) dimension-mismatch
    // error -- fail here instead, naming both the expected and actual length.
    if (values.length !== EMBEDDING_DIMENSION) {
      throw new Error(
        `Gemini returned an embedding with ${values.length} dimensions, expected ${EMBEDDING_DIMENSION}`,
      );
    }
    return values;
  }

  /**
   * Implements `AIProvider.generateStructuredOutput` via LangChain's standard structured-output
   * pattern: `ChatGoogleGenerativeAI.withStructuredOutput(schema)` returns a `Runnable` whose
   * `.invoke()` does the schema hinting (function-calling under the hood) + parse + Zod-validate
   * in one call.
   *
   * LangChain's own validation is a *hint*, not a guarantee this method relies on -- the returned
   * value is always re-parsed and re-validated against the caller's own `schema` here regardless,
   * exactly as this method's interface doc comment requires ("never trusts LangChain's schema
   * hinting alone"). Never retries internally; a caller wanting a corrected retry (e.g. this
   * story's citation-verification retry policy) calls this method again with a fresh prompt.
   */
  async generateStructuredOutput<T>(params: {
    systemInstruction: string;
    prompt: string;
    schema: ZodType<T>;
  }): Promise<T> {
    const structuredModel = this.chatModel.withStructuredOutput(params.schema);
    const raw = await structuredModel.invoke([
      ['system', params.systemInstruction],
      ['human', params.prompt],
    ]);

    // Zod's own SafeParseReturnType (a discriminated union on `success`), narrowed on its own
    // native type -- deliberately not routed through a bespoke wrapper type of this module's own,
    // since apps/api's own (deliberately non-strict) tsconfig type-checks this file too when it's
    // imported transitively, and TypeScript only narrows a *plain* discriminated union like that
    // reliably under `strictNullChecks` (this lib's own tsconfig opts into `strict: true`, but a
    // consuming app's looser config does not).
    const result = params.schema.safeParse(raw);
    if (!result.success) {
      const errorMessage = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      throw new Error(
        `Gemini's structured-output response failed schema validation: ${errorMessage}`,
      );
    }
    return result.data;
  }
}
