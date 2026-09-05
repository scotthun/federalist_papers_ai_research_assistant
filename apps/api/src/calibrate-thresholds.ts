/**
 * Entry point for the `api:calibrate-thresholds` Nx target (`npm run calibrate:thresholds`).
 *
 * `apps/api/src/app/ask/answer-thresholds.ts`'s `CONFIDENT_THRESHOLD`/`CLARIFY_THRESHOLD` are not
 * given anywhere in the planning docs -- `decisions.md` ("Confidence tiering") requires they be
 * calibrated empirically, using real similarity scores against the retrieval evaluation dataset
 * "extended with a handful of genuinely off-topic/unanswerable control questions so there's a
 * real 'should not be confident' signal to calibrate against." This script is that calibration
 * run: it embeds every question in both `retrieval-eval-dataset.json` (on-topic, Story 2.2) and
 * the new `retrieval-eval-dataset-offtopic.json` (genuinely unrelated control questions) for real
 * against the live embedding model and corpus, retrieves the top-K chunks for each via
 * `libs/retrieval`'s `retrieveRelevantChunks`, and reports the top similarity score per question
 * plus a min/max/avg summary per group -- the actual observed score spread this story's Design
 * Notes documents, and the evidence the chosen threshold constants are picked from.
 *
 * A deliberately separate, manually-run tool (mirrors `eval-retrieval.ts`'s own convention) --
 * never part of `nx run-many -t test`, and safe to re-run whenever the corpus or embedding model
 * changes enough that the thresholds might need recalibrating.
 */
import { Logger } from '@nestjs/common';
import { createEmbeddingProvider, type EmbeddingProvider } from '@federalist-research/ai';
import { createDataSource } from '@federalist-research/database';
import {
  DEFAULT_TOP_K,
  retrieveRelevantChunks,
  type RetrievedChunk,
} from '@federalist-research/retrieval';
import type { DataSource } from 'typeorm';
import { validateEnv } from './app/env.validation';
import { loadLocalEnv } from './load-local-env';
import offTopicDataset from './retrieval-eval-dataset-offtopic.json';
import onTopicDataset from './retrieval-eval-dataset.json';

// Loaded at module top level, before any env var is read below -- same rationale as
// eval-retrieval.ts's identical call.
loadLocalEnv();

// Reuses libs/retrieval's own default (rather than an independent literal that only claims, via a
// comment, to match it) so this calibration run's top-K genuinely matches AskService's.
const TOP_K = DEFAULT_TOP_K;

export type CalibrationGroup = 'on-topic' | 'off-topic';

export interface CalibrationCase {
  question: string;
}

export interface CalibrationCaseResult {
  group: CalibrationGroup;
  question: string;
  /** The top retrieved chunk's similarity score -- `undefined` only if retrieval returned zero
   *  chunks (an empty corpus) or the retrieval call itself failed for this question. */
  topScore?: number;
  scores: number[];
  error?: string;
}

export interface ScoreSummary {
  min: number;
  max: number;
  avg: number;
}

export interface CalibrationSummary {
  results: CalibrationCaseResult[];
  onTopicTopScores: ScoreSummary | undefined;
  offTopicTopScores: ScoreSummary | undefined;
}

function summarizeScores(scores: number[]): ScoreSummary | undefined {
  if (scores.length === 0) return undefined;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const avg = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return { min, max, avg };
}

/** Safe error text extraction -- a rejection isn't guaranteed to be an Error instance (mirrors
 *  ingest.ts/eval-retrieval.ts's identical helper). */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Runs every case in both groups through `retrieve`, recording the top score and full score list
 * per question. A single case's `retrieve` rejecting is caught and recorded (with the error
 * captured, `topScore` left `undefined`) rather than aborting the whole run -- same
 * continue-past-failure convention as `eval-retrieval.ts`'s `runEval`. Factored out from `main()`
 * so this aggregation logic is covered by fakes (`calibrate-thresholds.spec.ts`), not only by a
 * real run against the live corpus/API.
 */
export async function runCalibration(options: {
  onTopicCases: CalibrationCase[];
  offTopicCases: CalibrationCase[];
  retrieve: (question: string) => Promise<RetrievedChunk[]>;
  onResult?: (result: CalibrationCaseResult) => void;
}): Promise<CalibrationSummary> {
  const results: CalibrationCaseResult[] = [];

  const groups: Array<[CalibrationGroup, CalibrationCase[]]> = [
    ['on-topic', options.onTopicCases],
    ['off-topic', options.offTopicCases],
  ];

  for (const [group, cases] of groups) {
    for (const testCase of cases) {
      let result: CalibrationCaseResult;
      try {
        const retrieved = await options.retrieve(testCase.question);
        const scores = retrieved.map((chunk) => Number(chunk.score.toFixed(4)));
        result = {
          group,
          question: testCase.question,
          topScore: scores[0],
          scores,
        };
      } catch (err) {
        result = {
          group,
          question: testCase.question,
          scores: [],
          error: errorMessage(err),
        };
      }

      results.push(result);
      options.onResult?.(result);
    }
  }

  const onTopicTopScores = summarizeScores(
    results
      .filter((result) => result.group === 'on-topic' && result.topScore !== undefined)
      .map((result) => result.topScore as number),
  );
  const offTopicTopScores = summarizeScores(
    results
      .filter((result) => result.group === 'off-topic' && result.topScore !== undefined)
      .map((result) => result.topScore as number),
  );

  return { results, onTopicTopScores, offTopicTopScores };
}

/** Same rationale as `eval-retrieval.ts`'s `withEmbedDelay`: a modest delay before every real
 *  embedding call after the first, to avoid tripping Gemini's short-window rate limit across the
 *  combined on-topic + off-topic question set. */
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

async function runRealCalibration(
  dataSource: DataSource,
  aiProvider: EmbeddingProvider,
): Promise<CalibrationSummary> {
  const embedDelayMs = parseNonNegativeNumberEnv(process.env, 'CALIBRATE_EMBED_DELAY_MS', 250);

  return runCalibration({
    onTopicCases: onTopicDataset,
    offTopicCases: offTopicDataset,
    retrieve: withEmbedDelay(
      (question) => retrieveRelevantChunks(dataSource, aiProvider, question, { topK: TOP_K }),
      embedDelayMs,
    ),
    onResult: (result) => {
      Logger.log(JSON.stringify({ event: 'calibrate', ...result }), 'CalibrateThresholds');
    },
  });
}

async function main(): Promise<void> {
  const { DATABASE_URL } = validateEnv();
  const aiProvider = createEmbeddingProvider();
  const dataSource = createDataSource(DATABASE_URL);
  await dataSource.initialize();

  let summary: CalibrationSummary;
  try {
    summary = await runRealCalibration(dataSource, aiProvider);
  } finally {
    await dataSource.destroy();
  }

  Logger.log(
    `On-topic top scores: ${JSON.stringify(summary.onTopicTopScores)}`,
    'CalibrateThresholds',
  );
  Logger.log(
    `Off-topic top scores: ${JSON.stringify(summary.offTopicTopScores)}`,
    'CalibrateThresholds',
  );
}

// Guarded the same way ingest.ts/eval-retrieval.ts guard their real run -- importing this module
// (e.g. calibrate-thresholds.spec.ts importing runCalibration) must not itself trigger a real
// DB/AI/network run as an import side effect.
if (require.main === module) {
  main().catch((err) => {
    Logger.error(errorMessage(err), errorStack(err), 'CalibrateThresholds');
    process.exit(1);
  });
}
