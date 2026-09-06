/**
 * Extracts paper numbers explicitly named in a question's text (spec-explicit-paper-number-
 * pinning.md) -- e.g. "what is paper 4 about?", "compare this to Federalist No. 4". Retrieval is
 * pure semantic vector search over passage content, which has almost no signal for this class of
 * question: the words "paper 4" don't resemble Federalist No. 4's actual text at all, so a paper
 * named this way can be entirely absent from the unrestricted top-K even though it's fully present
 * in the database. `AskService` uses this to pin that paper's chunks as extra evidence, exactly
 * like it already does for the quill widget's `currentPaper` context chip.
 *
 * `Promise`-returning even though `RegexPaperReferenceExtractor`'s own implementation is
 * synchronous internally -- deliberately, so a future async implementation (e.g. one that makes an
 * LLM call, per this spec's Design Notes) satisfies the same interface with no signature change.
 */
export interface PaperReferenceExtractor {
  extractPaperNumbers(question: string): Promise<number[]>;
}

/** The valid Federalist Papers range -- 1 through 85 inclusive. Range validation belongs to the
 *  extractor's own responsibility (part of returning a clean `number[]`), not something callers
 *  re-check. */
const MIN_PAPER_NUMBER = 1;
const MAX_PAPER_NUMBER = 85;

/**
 * Matches a "paper"/"federalist"-anchored cluster naming one or more paper numbers -- "paper 4",
 * "paper no. 4", "paper #4", "federalist 4", "federalist no. 4", and multi-reference questions like
 * "papers 4 and 6" or "papers 1, 4, and 6" (the repeated `(?:,|and|&)` group lets one match span
 * every number in the list; only the digits are pulled back out of the whole match afterward,
 * since a JS regex can't capture a variable number of repeated groups individually).
 * Case-insensitive so "Paper 4"/"PAPER 4" also match.
 */
const KEYWORD_CLUSTER_PATTERN =
  /\b(?:paper|federalist)s?\s*(?:no\.?|#)?\s*\d+(?:\s*(?:,\s*(?:and\s*)?|and\s*|&\s*)(?:no\.?|#)?\d+)*/gi;

/**
 * Matches a bare "No. 4" reference (the archive's own citation convention, e.g.
 * "Federalist No. 51") when it appears on its own, without a "paper"/"federalist" keyword right
 * before it -- deliberately case-SENSITIVE on the capital "No." (unlike `KEYWORD_CLUSTER_PATTERN`
 * above) to avoid matching an unrelated lowercase "no" in ordinary prose (e.g. "no 4-hour
 * meetings"). A "No. 4" that *is* preceded by "federalist"/"paper" is already caught by
 * `KEYWORD_CLUSTER_PATTERN`; this pattern's matches are merged into the same deduplicating result
 * set, so it's harmless if both patterns happen to match overlapping text (e.g. "Federalist No.
 * 4").
 */
const STANDALONE_NO_PATTERN = /\bNo\.\s*(\d+)\b/g;

/**
 * `RegexPaperReferenceExtractor implements PaperReferenceExtractor` -- the only implementation
 * this story ships (see the spec's Design Notes for why regex is a defensible, reasonable choice
 * at this app's scale rather than a permanent architectural commitment). Returns validated,
 * in-range, capped-free (capping is `AskService`'s job, per `MAX_EXPLICIT_PAPER_PINS`),
 * deduplicated paper numbers, in first-seen order.
 */
export class RegexPaperReferenceExtractor implements PaperReferenceExtractor {
  // Declared `async` deliberately even though the implementation below is synchronous internally
  // -- see PaperReferenceExtractor's own doc comment for why (a future async implementation must
  // satisfy the same interface with no signature change).
  async extractPaperNumbers(question: string): Promise<number[]> {
    const seen = new Set<number>();
    const result: number[] = [];

    const addIfValid = (raw: string): void => {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < MIN_PAPER_NUMBER || n > MAX_PAPER_NUMBER) {
        // Out-of-range or malformed (e.g. "paper 200", "paper 0") -- silently dropped, never an
        // error (this story's Boundaries).
        return;
      }
      if (!seen.has(n)) {
        seen.add(n);
        result.push(n);
      }
    };

    for (const match of question.matchAll(KEYWORD_CLUSTER_PATTERN)) {
      const digitsInCluster = match[0].match(/\d+/g) ?? [];
      for (const raw of digitsInCluster) {
        addIfValid(raw);
      }
    }

    for (const match of question.matchAll(STANDALONE_NO_PATTERN)) {
      addIfValid(match[1]);
    }

    return result;
  }
}

/**
 * Factory (mirroring `createEmbeddingProvider()`/`createGenerationProvider()`'s shape in
 * `libs/ai/src/lib/ai-provider.factory.ts`) -- the single seam `AskService` depends on. Returns
 * `RegexPaperReferenceExtractor` today; swapping in a future implementation (e.g. an
 * LLM-based one) means changing this one function, not any call site.
 */
export function createPaperReferenceExtractor(): PaperReferenceExtractor {
  return new RegexPaperReferenceExtractor();
}
