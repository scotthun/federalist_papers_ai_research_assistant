import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  ProviderUnavailableError,
  type AIProvider,
  type ProviderFailureKind,
} from '@federalist-research/ai';
import {
  DEFAULT_TOP_K,
  getAllChunksForPaper,
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
  type CurrentPaper,
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

/** Used instead of `REFUSE_MESSAGE` when the fail-safe-to-refuse outcome was caused by the AI
 *  provider itself failing on both the first attempt and the one retry -- never for a citation-
 *  verification failure or malformed response the provider *did* return. `REFUSE_MESSAGE`'s
 *  wording ("I couldn't find sufficient evidence") is misleading for any of these causes: it
 *  implies a content/evidence problem when the real cause is that the model was never actually
 *  reached, or rejected the request outright.
 *
 * 2026-09-03 second follow-up: a single generic message here used to cover every provider
 * failure alike, but a 429 daily-quota exhaustion and a 503 overload are not the same problem --
 * "try again in a moment" is actively wrong for a quota that won't reset for hours. One message
 * per `ProviderFailureKind` instead, keyed by `messageForFailureKind` below. */
export const PROVIDER_UNAVAILABLE_MESSAGE =
  "The AI model is temporarily unavailable (it's experiencing high demand right now) -- please try asking again in a moment.";

const RATE_LIMITED_DAILY_MESSAGE =
  "This AI model has hit its free-tier daily request limit. It won't recover until the quota resets (typically within 24 hours) -- retrying now won't help; please try again later.";

function rateLimitedShortMessage(retryAfterSeconds?: number): string {
  const wait =
    retryAfterSeconds !== undefined ? `about ${retryAfterSeconds}s` : 'a few seconds';
  return `The AI model is being rate-limited right now -- please wait ${wait} and try asking again.`;
}

const SERVER_ERROR_MESSAGE =
  'The AI provider hit an internal error on its own end (not related to your question) -- please try asking again shortly.';

const CLIENT_ERROR_MESSAGE =
  "There's a configuration problem with the AI provider connection (not something your question caused) -- this needs a developer to look at, not a retry.";

/** Picks the actual answer text for a fail-safe-to-refuse outcome. `kind`/`retryAfterSeconds`
 *  are `undefined` for the original "the provider returned a response but citation verification
 *  rejected it" case, which still gets the unchanged `REFUSE_MESSAGE` -- never any of the
 *  provider-failure wording below. */
function messageForFailureKind(kind?: ProviderFailureKind, retryAfterSeconds?: number): string {
  switch (kind) {
    case 'rate_limited_daily':
      return RATE_LIMITED_DAILY_MESSAGE;
    case 'rate_limited_short':
      return rateLimitedShortMessage(retryAfterSeconds);
    case 'server_error':
      return SERVER_ERROR_MESSAGE;
    case 'client_error':
      return CLIENT_ERROR_MESSAGE;
    case 'overloaded':
    case 'unavailable':
      return PROVIDER_UNAVAILABLE_MESSAGE;
    case undefined:
      return REFUSE_MESSAGE;
  }
}

/** Priority order (most to least specific/actionable) for picking one `ProviderFailureKind` when
 *  the first attempt and the retry failed with *different* kinds -- e.g. the first hit a daily
 *  quota and the retry (pointlessly) hit it again framed differently, or one was a transient 503
 *  and the other a genuine config error. Telling the user about the more specific/blocking cause
 *  is always at least as true and more useful than the vaguer one. */
const FAILURE_KIND_PRIORITY: ProviderFailureKind[] = [
  'rate_limited_daily',
  'client_error',
  'rate_limited_short',
  'server_error',
  'overloaded',
  'unavailable',
];

function pickMoreSpecificFailureKind(
  a?: ProviderFailureKind,
  b?: ProviderFailureKind,
): ProviderFailureKind | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const aRank = FAILURE_KIND_PRIORITY.indexOf(a);
  const bRank = FAILURE_KIND_PRIORITY.indexOf(b);
  return aRank <= bRank ? a : b;
}

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

function refuseOutcome(
  error?: string,
  failureKind?: ProviderFailureKind,
  retryAfterSeconds?: number,
): AnswerOutcome {
  return {
    answer: messageForFailureKind(failureKind, retryAfterSeconds),
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
 *
 * This tier never runs at all when `currentPaper` is set (2026-09-03 second follow-up: `ask()`
 * forces the confident tier whenever a specific paper is pinned, letting the LLM itself attempt
 * a grounded answer rather than a templated guess) -- so `topChunk` here is always the true
 * archive-wide top score's chunk, never a current-paper preference.
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
  /** Set only when `errorMessage` came from a `ProviderUnavailableError` -- the call itself
   *  never reached a usable response (network/rate-limit/5xx/4xx), as opposed to a response the
   *  provider did return that failed schema validation (which leaves this `undefined`). */
  providerFailureKind?: ProviderFailureKind;
  /** Only meaningful alongside `providerFailureKind: 'rate_limited_short'` -- the provider's own
   *  suggested wait, when it supplied one. */
  retryAfterSeconds?: number;
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

  // `currentPaper` (Story 5.2, product-corrected 2026-09-02) is prompt context only -- retrieval
  // below always searches the whole archive regardless of whether it's present. The original
  // version of this method threaded it into `retrieveRelevantChunks`'s `paperNumber` filter
  // option instead; that's been reverted (see the spec's Spec Change Log) because it made a
  // genuinely cross-paper question unanswerable while the chip was showing.
  async ask(question: string, currentPaper?: CurrentPaper): Promise<Answer> {
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
      this.logRequest({
        question,
        tier: undefined,
        retrievalTier: undefined,
        chunks: [],
        start,
        error: errorMessage,
      });
      throw err;
    }

    // Tier is decided from the unrestricted search's own best match, captured here -- before any
    // pinned-paper chunks below are appended -- so pinning can never inflate (or otherwise
    // change) the confidence tier. A paper that didn't rank in the unrestricted top-K by
    // definition can't have scored higher than this.
    const topScore = chunks[0]?.score;
    const retrievalTier = decideAnswerTier(topScore);

    // 2026-09-03 second follow-up: pinning alone (above) only fixes *which evidence* the LLM
    // sees -- it does nothing about *whether* the LLM gets called at all, and a meta/summary-
    // style question ("give me a TLDR") structurally can't score well against retrievalTier's
    // archive-wide content-similarity gate no matter which paper is pinned, since the question
    // text doesn't resemble any passage's *content*. When the chip names a specific paper, that
    // is itself a deterministic, code-decided signal that real evidence exists -- stronger than
    // a raw similarity score for exactly this class of question -- so it overrides the gate to
    // let the LLM attempt a real, grounded answer. This does not weaken the "never trust the
    // LLM's self-reported confidence" principle behind that gate (decisions.md, "Confidence
    // tiering"): citation verification below still fails safe to refuse if the answer isn't
    // actually grounded, exactly as it already does for every other confident-tier attempt.
    const tier = currentPaper ? 'confident' : retrievalTier;

    // Pin the current paper's own full content as extra evidence when it didn't already make
    // the unrestricted top-K on its own merits (2026-09-03 follow-up to the product correction
    // above): a vague, low-signal question ("summarize this paper", "give me a TLDR") otherwise
    // has nothing anchoring it to the paper the user is actually reading, since retrieval no
    // longer filters by it. Unlike retrieveRelevantChunks, getAllChunksForPaper needs no
    // embedding/AIProvider call at all -- it's a plain lookup, so there's nothing here for a
    // flaky LLM provider to fail. Best-effort: a failure here degrades to just the unrestricted
    // results rather than failing the whole question over an enhancement.
    if (
      currentPaper &&
      !chunks.some((chunk) => chunk.paperNumber === currentPaper.paperNumber)
    ) {
      try {
        const pinnedChunks = await getAllChunksForPaper(
          this.dataSource,
          currentPaper.paperNumber,
        );
        chunks = [...chunks, ...pinnedChunks];
      } catch (err) {
        this.logger.warn(
          `Failed to pin current paper ${currentPaper.paperNumber}'s chunks as extra context: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const outcome = await this.resolveOutcome(tier, question, chunks, currentPaper);

    this.logRequest({
      question,
      tier,
      retrievalTier,
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
    currentPaper?: CurrentPaper,
  ): Promise<AnswerOutcome> {
    switch (tier) {
      case 'confident':
        // currentPaper is prompt context for the LLM only -- clarify/refuse below never run at
        // all when it's set (ask() forces this tier to 'confident' in that case), so there's
        // nothing for either of them to thread it into.
        return this.answerConfidently(question, chunks, currentPaper);
      case 'clarify':
        // decideAnswerTier only returns 'clarify' when chunks[0] exists (a defined topScore
        // requires at least one chunk) -- the non-null assertion documents that invariant rather
        // than re-deriving it. Only reachable when currentPaper is absent (see above).
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
    currentPaper?: CurrentPaper,
  ): Promise<AnswerOutcome> {
    const retrievedChunkIds = new Set(chunks.map((chunk) => chunk.chunkId));

    const first = await this.tryGenerate(question, chunks, undefined, currentPaper);
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
        currentPaper,
      );
    }

    return this.retryOrFailSafe(
      question,
      chunks,
      retrievedChunkIds,
      buildInvalidOutputCorrection(first.errorMessage),
      `first attempt produced invalid output: ${first.errorMessage}`,
      currentPaper,
      first.providerFailureKind,
    );
  }

  private async retryOrFailSafe(
    question: string,
    chunks: RetrievedChunk[],
    retrievedChunkIds: ReadonlySet<string>,
    correction: string,
    firstFailureReason: string,
    currentPaper?: CurrentPaper,
    /** The *first* attempt's own `ProviderFailureKind` (if it had one) -- `undefined` when the
     *  first attempt actually produced a response (e.g. this was called for a citation-
     *  verification failure instead). Combined with the retry's own outcome below to decide the
     *  final refuse message's wording. */
    firstFailureKind?: ProviderFailureKind,
  ): Promise<AnswerOutcome> {
    const retry = await this.tryGenerate(question, chunks, correction, currentPaper);
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
      // The retry *did* produce a response here, just one that still failed citation
      // verification -- a data-quality refuse, not a provider outage, regardless of whether the
      // first attempt was itself a provider failure.
      const retryFailureDetail =
        retry.citations.length === 0
          ? 'retry also returned zero citations'
          : `retry also cited invalid chunkId(s): ${verification.invalidChunkIds.join(', ')}`;
      return refuseOutcome(`${firstFailureReason}; ${retryFailureDetail}`);
    }

    // Neither attempt produced a usable response -- if either one's failure was a genuine
    // provider-side failure, say so honestly (and specifically -- a daily quota is not the same
    // problem as a transient overload) instead of implying an evidence problem (`decisions.md`'s
    // "Confidence tiering" citation-verification safety net still applies either way: this is
    // only about which message text is shown, never about skipping verification).
    const failureKind = pickMoreSpecificFailureKind(firstFailureKind, retry.providerFailureKind);
    return refuseOutcome(
      `${firstFailureReason}; retry also failed: ${retry.errorMessage}`,
      failureKind,
      retry.retryAfterSeconds,
    );
  }

  private async tryGenerate(
    question: string,
    chunks: RetrievedChunk[],
    correction?: string,
    currentPaper?: CurrentPaper,
  ): Promise<GenerateAttempt> {
    try {
      const output = await this.aiProvider.generateStructuredOutput({
        systemInstruction: ANSWER_SYSTEM_INSTRUCTION,
        prompt: buildAnswerPrompt(question, chunks, correction, currentPaper),
        schema: LlmAnswerOutputSchema,
      });
      return { answer: output.answer, citations: output.citations };
    } catch (err) {
      return {
        answer: '',
        citations: [],
        errorMessage: err instanceof Error ? err.message : String(err),
        providerFailureKind:
          err instanceof ProviderUnavailableError ? err.kind : undefined,
        retryAfterSeconds:
          err instanceof ProviderUnavailableError ? err.retryAfterSeconds : undefined,
      };
    }
  }

  /** Per-request logging (query, retrieved paper numbers, similarity scores, model/provider
   *  used, latency, errors) -- emitted for every tier, including the retrieval-failure path
   *  above, not just the confident/LLM-calling one (this story's Boundaries). */
  private logRequest(params: {
    question: string;
    tier: AnswerTier | undefined;
    /** The tier `decideAnswerTier` actually computed from the raw archive-wide top score --
     *  logged alongside `tier` (the effective tier resolveOutcome ran with) so an operator can
     *  tell a currentPaper override apart from a genuine confident-tier match (2026-09-03 second
     *  follow-up). `undefined` whenever `tier` itself is (the retrieval-failure path never gets
     *  this far). */
    retrievalTier: AnswerTier | undefined;
    chunks: RetrievedChunk[];
    start: number;
    error?: string;
    /** `true` only for a confident-tier answer that succeeded on its one allowed retry -- see
     *  `AnswerOutcome.retried`'s doc comment. Always logged as an explicit boolean (`false` when
     *  absent) so a successful retry is never silently indistinguishable from a first-try success
     *  in the request log. */
    retried?: boolean;
  }): void {
    const { question, tier, retrievalTier, chunks, start, error, retried } = params;
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
        tierOverriddenByCurrentPaper: tier !== undefined && tier !== retrievalTier,
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
