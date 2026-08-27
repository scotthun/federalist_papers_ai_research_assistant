import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { AIProvider } from '@federalist-research/ai';
import {
  DEFAULT_TOP_K,
  retrieveRelevantChunks,
  type RetrievedChunk,
} from '@federalist-research/retrieval';
import {
  LlmAnswerOutputSchema,
  type Answer,
  type Citation,
} from '@federalist-research/shared';
import { DataSource } from 'typeorm';
import { AI_PROVIDER } from '../ai-provider.provider';
import {
  ANSWER_SYSTEM_INSTRUCTION,
  buildAnswerPrompt,
  buildEmptyCitationsCorrection,
  buildInvalidCitationCorrection,
  buildInvalidOutputCorrection,
} from './answer-prompt';
import { decideAnswerTier, type AnswerTier } from './answer-thresholds';
import { verifyCitations } from './verify-citations';

/** Number of chunks retrieved as candidate context/evidence -- reuses `libs/retrieval`'s own
 *  default (`DEFAULT_TOP_K`) rather than redeclaring an independent literal that only claims, via
 *  a comment, to match it -- named here so the orchestrator's intent ("enough passages for a
 *  grounded answer, not just the bare top-1") is explicit rather than implicit in an omitted
 *  option. */
const TOP_K = DEFAULT_TOP_K;

export const REFUSE_MESSAGE =
  "I couldn't find sufficient evidence in the Federalist Papers to answer that confidently.";

/** The one shape ever produced by `AskService.ask` before `confidence`/`insufficientEvidence` are
 *  folded into the final `Answer` response -- kept separate from `Answer` itself only so `error`
 *  (logging-only, never returned to the client) has somewhere to live without polluting the
 *  public response schema. */
interface AnswerOutcome {
  answer: string;
  citations: Citation[];
  confidence: Answer['confidence'];
  insufficientEvidence: boolean;
  /** Set only when the confident tier's LLM call and/or citation verification failed at least
   *  once (first attempt, retry, or both) before this outcome was produced -- surfaced for
   *  logging/observability only. */
  error?: string;
  /** `true` only when a confident-tier answer succeeded on its one allowed retry (never on the
   *  first attempt, and never for the clarify/refuse tiers, including the fail-safe-to-refuse
   *  outcome after a retry that *also* failed) -- surfaced for logging/observability only, so a
   *  successful retry is no longer indistinguishable from a first-try success in the request log
   *  (the whole point of this flag: how often the model needs correcting). */
  retried?: boolean;
}

function refuseOutcome(error?: string): AnswerOutcome {
  return {
    answer: REFUSE_MESSAGE,
    citations: [],
    confidence: 'low',
    insufficientEvidence: true,
    ...(error ? { error } : {}),
  };
}

/**
 * The clarify tier's templated, code-generated response (`decisions.md`, "Confidence tiering"):
 * names the top retrieved chunk's paper as an unproven best guess. `quotedPassage`/
 * `relevanceExplanation` are deliberately omitted from the citation -- it's a guess, not a
 * verified source (this story's Boundaries).
 */
function clarifyOutcome(topChunk: RetrievedChunk): AnswerOutcome {
  return {
    answer:
      `I think you might be asking about Federalist No. ${topChunk.paperNumber} ` +
      `(${topChunk.paperTitle}), but I'm not confident enough to answer directly -- ` +
      'can you add more detail?',
    citations: [
      {
        paperNumber: topChunk.paperNumber,
        paperTitle: topChunk.paperTitle,
        chunkId: topChunk.chunkId,
      },
    ],
    confidence: 'low',
    insufficientEvidence: true,
  };
}

/**
 * Re-derives each citation's `paperNumber`/`paperTitle` from the actual retrieved chunk matching
 * its `chunkId`, never trusting the LLM's own echoed values for those two fields (this story's
 * real safety-net gap: `verifyCitations` only proves the `chunkId` itself was actually retrieved
 * -- it says nothing about whether the LLM's `paperNumber`/`paperTitle` for that citation are the
 * *real* metadata for that chunk or something fabricated alongside a genuine `chunkId`). Called
 * only after `verifyCitations` has already confirmed every `chunkId` is in `chunks`, so the lookup
 * below always finds a match; the no-match fallback (returning the citation unchanged) keeps this
 * function total rather than asserting, and still never fabricates metadata of its own if that
 * invariant somehow didn't hold. `chunkId`/`quotedPassage`/`relevanceExplanation` are left exactly
 * as the LLM returned them -- only the two re-derivable metadata fields are ever overwritten.
 */
function finalizeCitations(citations: Citation[], chunks: RetrievedChunk[]): Citation[] {
  const chunksById = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  return citations.map((citation) => {
    const chunk = chunksById.get(citation.chunkId);
    if (!chunk) {
      return citation;
    }
    return {
      ...citation,
      paperNumber: chunk.paperNumber,
      paperTitle: chunk.paperTitle,
    };
  });
}

/**
 * Deliberately an "always-present fields plus an optional `errorMessage`" shape, not a
 * `{ ok: true; ... } | { ok: false; ... }` discriminated union: apps/api's own tsconfig doesn't
 * opt into `strict`/`strictNullChecks` (unlike `libs/ai`'s), and without `strictNullChecks`,
 * TypeScript's control-flow narrowing of a boolean-discriminated union across an `if`/`else`
 * doesn't hold (confirmed directly: `if (x.ok) {...} else { x.errorMessage }` fails to narrow
 * without it). Checking `errorMessage !== undefined` narrows correctly either way, and mirrors
 * this codebase's existing convention for the same "success, or failure with a captured message"
 * shape (`eval-retrieval.ts`'s `EvalCaseResult.error?: string`). When `errorMessage` is set,
 * `answer`/`citations` are meaningless placeholders and must never be used.
 */
interface GenerateAttempt {
  answer: string;
  citations: Citation[];
  errorMessage?: string;
}

/**
 * Reads which concrete `AIProvider` is configured, for logging only (this story's Boundaries:
 * "model/provider used" is part of every request's log line). Deliberately reads `process.env`
 * directly rather than adding an identity/name concept to the `AIProvider` interface itself --
 * `apps/api`'s `env.validation.ts`/`ai-provider.factory.ts` already establish this as the one
 * place provider selection is configured, and this is observability metadata, not a decision the
 * orchestrator branches on.
 */
function resolveProviderName(env: Record<string, string | undefined> = process.env): string {
  return env['AI_PROVIDER'] ?? 'gemini';
}

/**
 * Backs `POST /api/ask` (Story 3.1's confident tier, Story 3.2's clarify/refuse tiers -- one
 * orchestrator entry point, per `epic-3-context.md`'s cross-story dependency note). Reads the top
 * retrieved chunk's similarity score, decides the tier entirely in code (`decideAnswerTier`,
 * never the LLM's self-report), and only calls the LLM for the confident tier -- with every
 * returned citation verified against the actually-retrieved chunk IDs before anything reaches the
 * response (`decisions.md`, "Citation verification").
 */
@Injectable()
export class AskService {
  private readonly logger = new Logger(AskService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider,
  ) {}

  async ask(question: string): Promise<Answer> {
    const start = Date.now();

    // The embedding call inside retrieveRelevantChunks is common to every tier -- a tier can't
    // even be decided without it. A failure here (e.g. a missing GEMINI_API_KEY) is therefore a
    // systemic configuration problem, not a per-tier one: it's logged and left to propagate as a
    // rejected promise, exactly like PapersService's identical `search/semantic` boundary (Story
    // 2.2) -- Nest's default exception filter turns that into a clear 500 response rather than a
    // hang or a fabricated 200 "insufficient evidence" answer that would misrepresent an outage
    // as a content outcome (I/O Edge-Case Matrix: "Embedding/LLM provider call fails ... Clear
    // error response ... Never a hang").
    let chunks: RetrievedChunk[];
    try {
      chunks = await retrieveRelevantChunks(this.dataSource, this.aiProvider, question, {
        topK: TOP_K,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logRequest({ question, tier: undefined, chunks: [], start, error: errorMessage });
      throw err;
    }

    const topScore = chunks[0]?.score;
    const tier = decideAnswerTier(topScore);

    const outcome = await this.resolveOutcome(tier, question, chunks);

    this.logRequest({
      question,
      tier,
      chunks,
      start,
      error: outcome.error,
      retried: outcome.retried,
    });

    return {
      answer: outcome.answer,
      citations: outcome.citations,
      confidence: outcome.confidence,
      insufficientEvidence: outcome.insufficientEvidence,
    };
  }

  private async resolveOutcome(
    tier: AnswerTier,
    question: string,
    chunks: RetrievedChunk[],
  ): Promise<AnswerOutcome> {
    switch (tier) {
      case 'confident':
        return this.answerConfidently(question, chunks);
      case 'clarify':
        // decideAnswerTier only returns 'clarify' when chunks[0] exists (a defined topScore
        // requires at least one chunk) -- the non-null assertion documents that invariant rather
        // than re-deriving it.
        return clarifyOutcome(chunks[0]);
      case 'refuse':
        return refuseOutcome();
    }
  }

  /**
   * The confident tier: calls the LLM with the retrieved passages/metadata and an "answer only
   * from this evidence" instruction, then verifies every returned citation's `chunkId` against
   * the actually-retrieved set. On a schema-invalid/malformed response OR a citation-verification
   * failure, retries exactly once with a fresh prompt carrying an explicit correction; if that
   * retry also fails (either way), fails safe to the refuse-tier response -- never throws, and
   * never silently strips just the bad citation (`decisions.md`, "Citation verification").
   */
  private async answerConfidently(
    question: string,
    chunks: RetrievedChunk[],
  ): Promise<AnswerOutcome> {
    const retrievedChunkIds = new Set(chunks.map((chunk) => chunk.chunkId));

    const first = await this.tryGenerate(question, chunks);
    if (first.errorMessage === undefined) {
      const verification = verifyCitations(first.citations, retrievedChunkIds);
      if (verification.valid) {
        return {
          answer: first.answer,
          citations: finalizeCitations(first.citations, chunks),
          confidence: 'high',
          insufficientEvidence: false,
        };
      }
      // An empty `citations` array is `verifyCitations`'s other invalid case (alongside a
      // fabricated chunkId), but `buildInvalidCitationCorrection` assumes there's at least one
      // invalid ID to name -- with none, it would produce a nonsensical correction ("... do not
      // exist in the evidence above: ." with a blank list). Detected here by `citations.length`
      // rather than `invalidChunkIds.length` so the distinction is explicit at the call site, not
      // inferred from `verifyCitations`'s internals.
      const isEmptyCitations = first.citations.length === 0;
      return this.retryOrFailSafe(
        question,
        chunks,
        retrievedChunkIds,
        isEmptyCitations
          ? buildEmptyCitationsCorrection()
          : buildInvalidCitationCorrection(verification.invalidChunkIds, [...retrievedChunkIds]),
        isEmptyCitations
          ? 'first attempt returned zero citations'
          : `first attempt cited invalid chunkId(s): ${verification.invalidChunkIds.join(', ')}`,
      );
    }

    return this.retryOrFailSafe(
      question,
      chunks,
      retrievedChunkIds,
      buildInvalidOutputCorrection(first.errorMessage),
      `first attempt produced invalid output: ${first.errorMessage}`,
    );
  }

  private async retryOrFailSafe(
    question: string,
    chunks: RetrievedChunk[],
    retrievedChunkIds: ReadonlySet<string>,
    correction: string,
    firstFailureReason: string,
  ): Promise<AnswerOutcome> {
    const retry = await this.tryGenerate(question, chunks, correction);
    if (retry.errorMessage === undefined) {
      const verification = verifyCitations(retry.citations, retrievedChunkIds);
      if (verification.valid) {
        return {
          answer: retry.answer,
          citations: finalizeCitations(retry.citations, chunks),
          confidence: 'high',
          insufficientEvidence: false,
          // Only ever `true` here -- the retry-succeeded branch -- never on a first-try success
          // or a fail-safe-to-refuse outcome, so a successful retry is distinguishable in the
          // request log from a first-try success (this story's logging Boundaries).
          retried: true,
        };
      }
      const retryFailureDetail =
        retry.citations.length === 0
          ? 'retry also returned zero citations'
          : `retry also cited invalid chunkId(s): ${verification.invalidChunkIds.join(', ')}`;
      return refuseOutcome(`${firstFailureReason}; ${retryFailureDetail}`);
    }

    return refuseOutcome(`${firstFailureReason}; retry also failed: ${retry.errorMessage}`);
  }

  private async tryGenerate(
    question: string,
    chunks: RetrievedChunk[],
    correction?: string,
  ): Promise<GenerateAttempt> {
    try {
      const output = await this.aiProvider.generateStructuredOutput({
        systemInstruction: ANSWER_SYSTEM_INSTRUCTION,
        prompt: buildAnswerPrompt(question, chunks, correction),
        schema: LlmAnswerOutputSchema,
      });
      return { answer: output.answer, citations: output.citations };
    } catch (err) {
      return {
        answer: '',
        citations: [],
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Per-request logging (query, retrieved paper numbers, similarity scores, model/provider
   *  used, latency, errors) -- emitted for every tier, including the retrieval-failure path
   *  above, not just the confident/LLM-calling one (this story's Boundaries). */
  private logRequest(params: {
    question: string;
    tier: AnswerTier | undefined;
    chunks: RetrievedChunk[];
    start: number;
    error?: string;
    /** `true` only for a confident-tier answer that succeeded on its one allowed retry -- see
     *  `AnswerOutcome.retried`'s doc comment. Always logged as an explicit boolean (`false` when
     *  absent) so a successful retry is never silently indistinguishable from a first-try success
     *  in the request log. */
    retried?: boolean;
  }): void {
    const { question, tier, chunks, start, error, retried } = params;
    // Explicit `!== undefined` check, not a truthy check -- an `Error` with an empty-string
    // `.message` (e.g. `new Error('')`) is still a genuine error and must log at 'error' level,
    // not silently fall through to 'log' just because the message happens to be falsy. Mirrors
    // this file's own `GenerateAttempt.errorMessage !== undefined` convention (see that
    // interface's doc comment above).
    const logMethod = error !== undefined ? 'error' : 'log';
    this.logger[logMethod](
      JSON.stringify({
        event: 'ask',
        question,
        tier,
        retrievedPaperNumbers: chunks.map((chunk) => chunk.paperNumber),
        similarityScores: chunks.map((chunk) => Number(chunk.score.toFixed(4))),
        provider: resolveProviderName(),
        llmCalled: tier === 'confident',
        latencyMs: Date.now() - start,
        retried: retried === true,
        ...(error ? { error } : {}),
      }),
    );
  }
}
