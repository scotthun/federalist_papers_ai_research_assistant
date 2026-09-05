/**
 * Entry point for the `api:eval-retrieval` Nx target (`npm run eval:retrieval`). Embeds each
 * question in `retrieval-eval-dataset.json` for real against the live embedding model (this is
 * the one place outside `ingest.ts` that calls it), retrieves the top-K chunks via
 * `libs/retrieval`'s `retrieveRelevantChunks`, and reports whether each question's expected
 * paper(s) appear among them -- proving the semantic-search path actually works against the real
 * corpus (this story's Acceptance Criteria), not just that its SQL is correct in isolation
 * (that's retrieval.integration.spec.ts's job, with hand-crafted vectors). A deliberately
 * separate, manually-run verification step (Story 2.2's Boundaries) -- never part of
 * `nx run-many -t test`.
 *
 * The per-question loop is factored into `runEval()` (an injectable, exported function) so its
 * hit/miss detection and pass/fail aggregation are covered by eval-retrieval.spec.ts with fakes,
 * rather than only being exercised by a real run against the live corpus/API -- mirrors
 * ingest.ts's `runIngestion` split. Like that same split, a single case's `retrieve` rejecting is
 * caught and recorded as a miss rather than aborting the rest of the run, and (only for the real
 * run, via `withEmbedDelay`/`EVAL_EMBED_DELAY_MS`) each real embedding call after the first is
 * preceded by a small delay -- ingest.ts's `INGEST_EMBED_DELAY_MS` pattern, applied here because
 * this script also makes one real embedding call per dataset question with no delay otherwise.
 */
import { Logger } from '@nestjs/common';
import { createEmbeddingProvider, type EmbeddingProvider } from '@federalist-research/ai';
import { createDataSource } from '@federalist-research/database';
import { retrieveRelevantChunks, type RetrievedChunk } from '@federalist-research/retrieval';
import type { DataSource } from 'typeorm';
import { validateEnv } from './app/env.validation';
import { loadLocalEnv } from './load-local-env';
import evalDataset from './retrieval-eval-dataset.json';

// Loaded at module top level, before any env var is read below -- same rationale as ingest.ts's
// identical call: `.env` values must already be in `process.env` by the time loadConfig/
// createEmbeddingProvider/validateEnv run.
loadLocalEnv();

const TOP_K = 5;

export interface EvalCase {
  question: string;
  expectedPapers: number[];
}

export interface EvalCaseResult {
  question: string;
  expectedPapers: number[];
  retrievedPapers: number[];
  scores: number[];
  hit: boolean;
  latencyMs: number;
  /** Set only when `options.retrieve` rejected for this case (e.g. a flaky network call, a
   *  Gemini rate-limit blip) -- the case is still recorded as a miss (`hit: false`) rather than
   *  aborting the whole run; see `runEval`'s per-case try/catch. */
  error?: string;
}

export interface EvalSummary {
  allPassed: boolean;
  results: EvalCaseResult[];
}

/**
 * Runs every case in `cases` through `retrieve`, reporting whether at least one of that case's
 * `expectedPapers` appears among the retrieved chunks' paper numbers. Factored out from `main()`
 * so this hit/miss + pass/fail aggregation logic is covered by fakes (eval-retrieval.spec.ts)
 * instead of only by a real run against the live corpus and embedding API.
 *
 * A single case's `retrieve` rejecting (e.g. a flaky network call, a Gemini rate-limit blip)
 * never aborts the run and discards every other case's result -- it's caught, recorded as a miss
 * with the error captured on that case's result, and the loop continues, mirroring ingest.ts's
 * `runIngestion` continue-past-failure convention for its own per-paper loop.
 */
export async function runEval(options: {
  cases: EvalCase[];
  retrieve: (question: string) => Promise<RetrievedChunk[]>;
  onResult?: (result: EvalCaseResult) => void;
}): Promise<EvalSummary> {
  const results: EvalCaseResult[] = [];
  let allPassed = true;

  for (const testCase of options.cases) {
    const start = Date.now();
    let result: EvalCaseResult;

    try {
      const retrieved = await options.retrieve(testCase.question);
      const retrievedPapers = [...new Set(retrieved.map((chunk) => chunk.paperNumber))];
      const hit = testCase.expectedPapers.some((paperNumber) =>
        retrievedPapers.includes(paperNumber),
      );

      result = {
        question: testCase.question,
        expectedPapers: testCase.expectedPapers,
        retrievedPapers,
        scores: retrieved.map((chunk) => Number(chunk.score.toFixed(4))),
        hit,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      result = {
        question: testCase.question,
        expectedPapers: testCase.expectedPapers,
        retrievedPapers: [],
        scores: [],
        hit: false,
        latencyMs: Date.now() - start,
        error: errorMessage(err),
      };
    }

    results.push(result);
    options.onResult?.(result);

    if (!result.hit) {
      allPassed = false;
    }
  }

  return { allPassed, results };
}

/** Safe error text extraction -- a rejection isn't guaranteed to be an Error instance (mirrors
 *  ingest.ts's identical helper). */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mirrors ingest.ts's identical helper: fail fast on a malformed env var rather than silently
 *  coercing it to NaN/0. */
function parseNonNegativeNumberEnv(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: number,
): number {
  const raw = env[key];
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be a non-negative number, got "${raw}"`);
  }
  return value;
}

/**
 * Wraps `retrieve` so every call *after* the first awaits `delayMs` first (never before the
 * first call -- no reason to delay a run that's only making one request). Kept separate from
 * `runEval` itself so that function stays delay-agnostic and fake-friendly (its own spec never
 * has to wait out a real delay); only `runRealEval` -- which calls the real embedding model --
 * applies it. Same rationale as ingest.ts's `INGEST_EMBED_DELAY_MS`: observed live, embedding in
 * quick succession trips the Gemini API's short-window rate limit (HTTP 429 RESOURCE_EXHAUSTED),
 * and this dataset makes one embedding call per question with no delay otherwise.
 */
export function withEmbedDelay(
  retrieve: (question: string) => Promise<RetrievedChunk[]>,
  delayMs: number,
  sleepFn: (ms: number) => Promise<void> = sleep,
): (question: string) => Promise<RetrievedChunk[]> {
  let isFirstCall = true;
  return async (question: string) => {
    if (!isFirstCall) {
      await sleepFn(delayMs);
    }
    isFirstCall = false;
    return retrieve(question);
  };
}

async function runRealEval(
  dataSource: DataSource,
  aiProvider: EmbeddingProvider,
): Promise<EvalSummary> {
  const embedDelayMs = parseNonNegativeNumberEnv(process.env, 'EVAL_EMBED_DELAY_MS', 250);

  return runEval({
    cases: evalDataset,
    retrieve: withEmbedDelay(
      (question) => retrieveRelevantChunks(dataSource, aiProvider, question, { topK: TOP_K }),
      embedDelayMs,
    ),
    onResult: (result) => {
      Logger.log(JSON.stringify({ event: 'eval', ...result }), 'EvalRetrieval');
    },
  });
}

async function main(): Promise<void> {
  const { DATABASE_URL } = validateEnv();
  // Constructed before the loop: a missing GEMINI_API_KEY (embeddings always use Gemini,
  // regardless of AI_PROVIDER) is a systemic problem, not a per-question one -- fail fast rather
  // than attempting (and failing) every question in the dataset (same rationale as ingest.ts's
  // identical call).
  const aiProvider = createEmbeddingProvider();
  const dataSource = createDataSource(DATABASE_URL);
  await dataSource.initialize();

  let summary: EvalSummary;
  try {
    summary = await runRealEval(dataSource, aiProvider);
  } finally {
    await dataSource.destroy();
  }

  const missCount = summary.results.filter((result) => !result.hit).length;
  Logger.log(
    summary.allPassed
      ? `EVAL PASSED: all ${summary.results.length} questions found an expected paper in the top-${TOP_K}`
      : `EVAL FAILED: ${missCount} of ${summary.results.length} questions missed -- see the per-question logs above`,
    'EvalRetrieval',
  );

  if (!summary.allPassed) {
    process.exit(1);
  }
}

// Guarded the same way ingest.ts guards its real run -- importing this module (e.g.
// eval-retrieval.spec.ts importing `runEval`) must not itself trigger a real DB/AI/network run
// as an import side effect.
if (require.main === module) {
  main().catch((err) => {
    Logger.error(errorMessage(err), errorStack(err), 'EvalRetrieval');
    process.exit(1);
  });
}
