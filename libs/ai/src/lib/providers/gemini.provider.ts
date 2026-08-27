import { GoogleGenAI } from '@google/genai';
import { z, type ZodType } from 'zod';
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

/** Concrete Adapter wrapping `@google/genai` behind the `AIProvider` interface -- the one
 *  initial provider (stack.md: "implement at least one provider initially"). */
export class GeminiProvider implements AIProvider {
  private readonly client: GoogleGenAI;

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey) {
      throw new Error('GeminiProvider requires a non-empty apiKey');
    }
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
    });
    const values = response.embeddings?.[0]?.values;
    if (!values) {
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
   * Implements `AIProvider.generateStructuredOutput` via `@google/genai`'s JSON-mode/structured-
   * output support: `responseMimeType: 'application/json'` plus `responseJsonSchema` (the SDK's
   * plain-JSON-Schema alternative to its own proprietary `responseSchema` `Schema` type) built
   * from the passed Zod `schema` with Zod 4's built-in `z.toJSONSchema()` -- no extra dependency
   * needed for the Zod -> JSON Schema conversion (this story's "Ask First" boundary on new
   * dependencies is satisfied by not needing one).
   *
   * The SDK's own schema hinting is a *hint*, not a guarantee -- the returned JSON is always
   * re-parsed and re-validated against `schema` here regardless, exactly as this method's
   * interface doc comment requires. Never retries internally; a caller wanting a corrected retry
   * (e.g. this story's citation-verification retry policy) calls this method again with a fresh
   * prompt.
   */
  async generateStructuredOutput<T>(params: {
    systemInstruction: string;
    prompt: string;
    schema: ZodType<T>;
  }): Promise<T> {
    const response = await this.client.models.generateContent({
      model: GENERATION_MODEL,
      contents: params.prompt,
      config: {
        systemInstruction: params.systemInstruction,
        responseMimeType: 'application/json',
        responseJsonSchema: z.toJSONSchema(params.schema),
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error('Gemini returned no text response for a structured-output request');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Gemini's structured-output response was not valid JSON: ${(err as Error).message}`,
      );
    }

    // Zod's own SafeParseReturnType (a discriminated union on `success`), narrowed on its own
    // native type -- deliberately not routed through a bespoke wrapper type of this module's own,
    // since apps/api's own (deliberately non-strict) tsconfig type-checks this file too when it's
    // imported transitively, and TypeScript only narrows a *plain* discriminated union like that
    // reliably under `strictNullChecks` (this lib's own tsconfig opts into `strict: true`, but a
    // consuming app's looser config does not).
    const result = params.schema.safeParse(parsed);
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
