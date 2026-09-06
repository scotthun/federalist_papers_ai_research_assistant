/**
 * Entry point for the `api:ingest` Nx target (`npm run ingest:federalist-papers`). Fetches all
 * 85 Federalist Papers from the Avalon Project, and for each one: parses (`libs/documents`),
 * chunks (`libs/documents`), embeds (`libs/ai`), and stores (`libs/database`) it -- one DB
 * transaction per paper (AD-10). A single paper's failure is logged and the run continues; it
 * never aborts the remaining papers.
 *
 * `libs/documents` and `libs/ai` do no I/O themselves (AD-6/AD-11) -- this orchestrator performs
 * the HTTP fetch and composes the three libs.
 *
 * The per-paper loop is factored into `runIngestion()` (an injectable, exported function) so its
 * continue-past-failure behavior and succeeded/failed counts are covered by ingest.spec.ts with
 * fakes, rather than only being exercised by a real end-to-end run.
 */
import { Logger } from '@nestjs/common';
import { createEmbeddingProvider, type EmbeddingProvider } from '@federalist-research/ai';
import {
  createDataSource,
  upsertPaperWithChunks,
} from '@federalist-research/database';
import {
  chunkText,
  DEFAULT_CHUNK_OPTIONS,
  parseAvalonPaper,
  type ChunkOptions,
} from '@federalist-research/documents';
import type { DataSource } from 'typeorm';
import { validateEnv } from './app/env.validation';
import { loadLocalEnv } from './load-local-env';

// Loaded at module top level, before any env var is read below -- `.env` values (the documented
// way to configure the vars `loadIngestConfig` reads, per apps/api/.env.example) must already be
// in `process.env` by the time that function runs. Previously the ingest-specific env vars were
// computed as module-level consts (evaluated at import time) while this call happened inside
// main() (later) -- .env values were silently ignored; only real shell-exported vars worked.
loadLocalEnv();

const FETCH_TIMEOUT_MS = 30_000;

function sourceUrlFor(paperNumber: number): string {
  const padded = String(paperNumber).padStart(2, '0');
  return `https://avalon.law.yale.edu/18th_century/fed${padded}.asp`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Safe error text extraction -- a rejection isn't guaranteed to be an Error instance. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorStack(err: unknown): string | undefined {
  return err instanceof Error ? err.stack : undefined;
}

function parseIntEnv(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: number,
): number {
  const raw = env[key];
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be an integer, got "${raw}"`);
  }
  return value;
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

export interface IngestConfig {
  firstPaperNumber: number;
  lastPaperNumber: number;
  fetchDelayMs: number;
  embedDelayMs: number;
  chunkOptions: ChunkOptions;
}

/**
 * Reads and validates every ingest-specific env var, failing fast with a clear error rather than
 * letting a malformed value silently become NaN -- which previously made the ingest loop run
 * zero iterations while still reporting success (see `shouldExitWithError`).
 */
export function loadIngestConfig(
  env: Record<string, string | undefined> = process.env,
): IngestConfig {
  const firstPaperNumber = parseIntEnv(env, 'INGEST_FIRST_PAPER', 1);
  const lastPaperNumber = parseIntEnv(env, 'INGEST_LAST_PAPER', 85);
  if (firstPaperNumber > lastPaperNumber) {
    throw new Error(
      `INGEST_FIRST_PAPER (${firstPaperNumber}) must be <= INGEST_LAST_PAPER (${lastPaperNumber})`,
    );
  }

  return {
    firstPaperNumber,
    lastPaperNumber,
    // Avalon's rate-limiting behavior is untested/unguarded against (Story 0.1 spike) -- a
    // modest delay between sequential page fetches is a cheap, configurable precaution.
    fetchDelayMs: parseNonNegativeNumberEnv(env, 'INGEST_FETCH_DELAY_MS', 500),
    // Observed live (2026-08-24): embedding all of a paper's chunks concurrently across many
    // papers in quick succession trips the Gemini API's short-window rate limit (HTTP 429
    // RESOURCE_EXHAUSTED). Embedding sequentially with a modest, configurable delay keeps the
    // request rate steady instead of bursty -- a rate-limit failure is still handled the same
    // way as any other per-paper failure (logged, run continues); this just makes hitting it in
    // the first place less likely.
    embedDelayMs: parseNonNegativeNumberEnv(env, 'INGEST_EMBED_DELAY_MS', 250),
    // Chunk size is configurable, not hard-coded (stack.md) -- these env vars are the runtime
    // knob; DEFAULT_CHUNK_OPTIONS supplies the default value for each.
    chunkOptions: {
      targetWords: parseIntEnv(
        env,
        'INGEST_CHUNK_TARGET_WORDS',
        DEFAULT_CHUNK_OPTIONS.targetWords,
      ),
      maxWords: parseIntEnv(
        env,
        'INGEST_CHUNK_MAX_WORDS',
        DEFAULT_CHUNK_OPTIONS.maxWords,
      ),
      overlapWords: parseNonNegativeNumberEnv(
        env,
        'INGEST_CHUNK_OVERLAP_WORDS',
        DEFAULT_CHUNK_OPTIONS.overlapWords,
      ),
    },
  };
}

export interface IngestPaperResult {
  chunkCount: number;
  authors: string[];
}

export async function ingestPaper(
  paperNumber: number,
  dataSource: DataSource,
  aiProvider: EmbeddingProvider,
  chunkOptions: ChunkOptions,
  embedDelayMs: number,
): Promise<IngestPaperResult> {
  const sourceUrl = sourceUrlFor(paperNumber);

  // Native fetch, never a shelled-out process. This environment's Node trust store doesn't
  // include the root CA avalon.law.yale.edu chains to (though curl, using the OS keychain,
  // does) -- `--use-system-ca` on the `ingest` target's run command (see project.json) makes
  // Node trust the same system store, which is the real fix for that gap rather than
  // reintroducing a curl shell-out. A per-request timeout bounds a single hanging/slow response
  // so it can't stall the whole 85-paper run indefinitely -- a timeout surfaces as a normal
  // per-paper failure via the same catch/continue path as any other error.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(sourceUrl, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(
      `Fetch failed with HTTP ${response.status} for ${sourceUrl}`,
    );
  }
  const html = await response.text();

  const parsed = parseAvalonPaper(html, paperNumber);
  const chunkContents = chunkText(parsed.fullText, chunkOptions);
  if (chunkContents.length === 0) {
    // Would otherwise silently store the paper's metadata with zero chunks (upsertPaperWithChunks
    // guards its insert on chunks.length > 0) -- treat "nothing to embed" as a failure, not a
    // silent success, so it's caught and logged like any other per-paper problem.
    throw new Error(
      `Chunking produced zero chunks for paper ${paperNumber} -- refusing to store it with no content`,
    );
  }

  const chunks: Array<{
    chunkIndex: number;
    content: string;
    embedding: number[];
  }> = [];
  for (const [chunkIndex, content] of chunkContents.entries()) {
    if (chunkIndex > 0) {
      await sleep(embedDelayMs);
    }
    const embedding = await aiProvider.generateEmbedding(content);
    chunks.push({ chunkIndex, content, embedding });
  }

  await upsertPaperWithChunks(dataSource, {
    paperNumber: parsed.paperNumber,
    title: parsed.title,
    authorNames: parsed.authors,
    sourceUrl,
    fullText: parsed.fullText,
    chunks,
  });

  return { chunkCount: chunks.length, authors: parsed.authors };
}

export interface IngestionSummary {
  succeeded: number;
  failed: number;
}

/**
 * Runs `ingestOnePaper` over `paperNumbers` in order, continuing past any single paper's
 * rejection (reported via `onFailure`, never re-thrown) rather than aborting the run -- the
 * behavior this story's I/O Edge-Case Matrix requires. Factored out from `main()` so it's
 * covered by ingest.spec.ts with injected fakes, rather than only by a real 85-paper run.
 */
export async function runIngestion(options: {
  paperNumbers: number[];
  fetchDelayMs: number;
  ingestOnePaper: (paperNumber: number) => Promise<IngestPaperResult>;
  onSuccess?: (
    paperNumber: number,
    result: IngestPaperResult,
    latencyMs: number,
  ) => void;
  onFailure?: (paperNumber: number, err: unknown) => void;
  sleepFn?: (ms: number) => Promise<void>;
}): Promise<IngestionSummary> {
  const sleepFn = options.sleepFn ?? sleep;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < options.paperNumbers.length; i++) {
    const paperNumber = options.paperNumbers[i];
    const start = Date.now();
    try {
      const result = await options.ingestOnePaper(paperNumber);
      succeeded += 1;
      options.onSuccess?.(paperNumber, result, Date.now() - start);
    } catch (err) {
      failed += 1;
      options.onFailure?.(paperNumber, err);
    }

    if (i < options.paperNumbers.length - 1) {
      await sleepFn(options.fetchDelayMs);
    }
  }

  return { succeeded, failed };
}

/**
 * A run that ingests zero papers successfully is never reported as success -- covers both "every
 * paper failed" and "the range was misconfigured/empty" (dropping the previous `failed > 0`
 * condition, which let a zero-papers-processed run report "0 succeeded, 0 failed" and still
 * exit 0).
 */
export function shouldExitWithError(summary: IngestionSummary): boolean {
  return summary.succeeded === 0;
}

function paperNumberRange(first: number, last: number): number[] {
  const numbers: number[] = [];
  for (let n = first; n <= last; n++) numbers.push(n);
  return numbers;
}

async function main(): Promise<void> {
  const config = loadIngestConfig();
  const { DATABASE_URL } = validateEnv();
  // Constructed before the loop: a missing GEMINI_API_KEY (embeddings always use Gemini,
  // regardless of AI_PROVIDER) is a systemic problem, not a per-paper one -- fail fast rather than
  // attempting (and failing) 85 times.
  const aiProvider = createEmbeddingProvider();

  const dataSource = createDataSource(DATABASE_URL);
  await dataSource.initialize();

  let summary: IngestionSummary;
  try {
    summary = await runIngestion({
      paperNumbers: paperNumberRange(
        config.firstPaperNumber,
        config.lastPaperNumber,
      ),
      fetchDelayMs: config.fetchDelayMs,
      ingestOnePaper: (paperNumber) =>
        ingestPaper(
          paperNumber,
          dataSource,
          aiProvider,
          config.chunkOptions,
          config.embedDelayMs,
        ),
      onSuccess: (paperNumber, result, latencyMs) => {
        Logger.log(
          JSON.stringify({
            event: 'ingest',
            paperNumber,
            authors: result.authors,
            chunkCount: result.chunkCount,
            latencyMs,
          }),
          'Ingest',
        );
      },
      onFailure: (paperNumber, err) => {
        Logger.error(
          `Failed to ingest paper ${paperNumber}: ${errorMessage(err)}`,
          errorStack(err),
          'Ingest',
        );
      },
    });
  } finally {
    await dataSource.destroy();
  }

  Logger.log(
    `Ingestion complete: ${summary.succeeded} succeeded, ${summary.failed} failed.`,
    'Ingest',
  );

  if (shouldExitWithError(summary)) {
    process.exit(1);
  }
}

// Guards real execution behind "run directly as the entry script" so ingest.spec.ts can import
// the functions above (runIngestion, loadIngestConfig, ingestPaper, ...) without triggering a
// real DB/AI/network run as an import side effect.
if (require.main === module) {
  main().catch((err) => {
    Logger.error(errorMessage(err), errorStack(err), 'Ingest');
    process.exit(1);
  });
}
