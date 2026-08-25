import { GoogleGenAI } from '@google/genai';
import type { AIProvider } from '../ai-provider.interface';

// Verified live against the Gemini API (Story 0.1 spike, 2026-08-24): gemini-embedding-001
// returns 3072-dimensional embeddings by default. libs/database's `document_chunks.embedding`
// column is pinned to exactly this dimension -- changing it is a deliberate, separately-costed
// migration (decisions.md), not something this adapter should silently vary.
const EMBEDDING_MODEL = 'gemini-embedding-001';
const EMBEDDING_DIMENSION = 3072;

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
}
