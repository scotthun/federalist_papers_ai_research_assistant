import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { Answer } from '@federalist-research/shared';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import type { ConversationTurn } from './answer-prompt';
import { AskService } from './ask.service';

/**
 * Caps how many prior question/answer pairs are threaded into a single `/api/ask` call
 * (spec-conversation-history-context.md). `null` (the shipped default) sends the *entire*
 * conversation -- matching how hosted chat LLM products behave (Design Notes: "conversation" is
 * always the caller resending prior turns, typically up to the model's real context window).
 * Implemented (not deleted) as a real, working cap specifically so it can be flipped to a number
 * (e.g. `3`) as a one-line rollback if full history proves problematic in practice (rising
 * latency/cost across long sessions, or `context_length_exceeded` firing often) -- without
 * re-deriving the capping logic from scratch. See this story's Design Notes for what to check
 * before flipping it.
 *
 * Exported so `coerceHistory`'s cap logic can be exercised directly with an explicit non-null
 * `maxTurns` in tests (this story's I/O matrix: the rollback path "is exercised by a test even
 * though the shipped default is null, so the rollback path is proven to work before it's ever
 * needed") -- without needing to actually flip this module-level default.
 */
export const HISTORY_MAX_TURNS: number | null = null;

/** Structural guard for one raw `history` array element -- `question`/`answer` both present and
 *  string-typed. Anything else (missing field, non-string value, not even an object) fails this
 *  check and is dropped by `coerceHistory` below, never causing a 400 (this story's Boundaries:
 *  "a malformed entry ... degrades to 'drop the malformed entry' ... never a 400"). */
function isValidHistoryEntry(entry: unknown): entry is ConversationTurn {
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }
  const candidate = entry as Record<string, unknown>;
  return typeof candidate.question === 'string' && typeof candidate.answer === 'string';
}

/**
 * Validates/coerces the request body's raw `history` field into a typed, capped
 * `ConversationTurn[]` (spec-conversation-history-context.md). Non-array input (a string, object,
 * or absent) degrades to `[]` -- treated exactly like "no history" rather than a 400. Malformed
 * individual entries are dropped rather than rejecting the whole field, so one bad entry (e.g.
 * from an older/mismatched client build) never costs the rest of a real conversation. `maxTurns`
 * defaults to the module's own `HISTORY_MAX_TURNS` (the real, shipped cap) but is accepted as a
 * parameter -- rather than only ever reading the module-level constant -- so a test can exercise
 * the rollback path (a non-null cap) directly without needing to actually flip the shipped
 * default (this story's I/O matrix).
 */
export function coerceHistory(
  rawHistory: unknown,
  maxTurns: number | null = HISTORY_MAX_TURNS,
): ConversationTurn[] {
  if (!Array.isArray(rawHistory)) {
    return [];
  }
  const validTurns = rawHistory.filter(isValidHistoryEntry);
  if (maxTurns === null || validTurns.length <= maxTurns) {
    return validTurns;
  }
  return validTurns.slice(-maxTurns);
}

/** Loose on purpose: the request body is untrusted input, not yet known to actually contain a
 *  string `question` -- `ask` below is what turns it into a validated, guaranteed-non-blank
 *  string before anything else (retrieval, the LLM) ever runs. */
export interface AskRequestBody {
  question?: unknown;
  /** Optional prompt context (Story 5.2, product-corrected 2026-09-02) -- set by the quill widget
   *  only when its context chip is showing (client-controlled, not end-user-typed). Threaded into
   *  the LLM's prompt as framing ("the user is reading paper N"), never into the retrieval
   *  filter -- retrieval always searches the whole archive regardless of these fields. Only
   *  usable together with `paperTitle`; anything other than a positive integer (non-number,
   *  NaN/Infinity, zero, negative, or fractional) is treated as absent (no context, no error) --
   *  see `ask()`'s coercion below. */
  paperNumber?: unknown;
  /** Paired with `paperNumber` above -- only usable when both are valid. Anything other than a
   *  non-empty (after trim) string is treated as absent. */
  paperTitle?: unknown;
  /** Optional prior conversation (spec-conversation-history-context.md), sent by the quill panel
   *  on every ask so a follow-up question can be understood in context. Untyped here on purpose
   *  (same rationale as `question` above) -- `coerceHistory` is what turns it into a validated
   *  `ConversationTurn[]`, degrading absence/malformed shapes to "no history" rather than a 400. */
  history?: unknown;
}

/**
 * `POST /api/ask` (Stories 3.1/3.2 -- one orchestrator entry point shared by both, per
 * `epic-3-context.md`'s cross-story dependency note). Same thin controller/service/module
 * pattern as `PapersController`/`PapersService`/`PapersModule` (Story 1.3 onward) -- the only
 * real work is `AskService.ask`; this layer's own job is turning the raw request body into a
 * validated question string.
 */
@Controller('ask')
export class AskController {
  constructor(private readonly askService: AskService) {}

  /**
   * A blank/whitespace (or non-string, or absent) `question` is a 400 -- a request-format error,
   * distinct from "no evidence found" (a content outcome the service itself returns as the
   * refuse tier's `Answer`). Checked here, before `AskService.ask` is ever called, so a malformed
   * request never reaches retrieval or the LLM (this story's I/O Edge-Case Matrix).
   */
  // A question-answering action, not a resource-creation one -- 200 (Nest's `@Post()` default is
  // 201) is the more accurate status for what this endpoint actually does.
  // RateLimitGuard (spec-4-2-rate-limiting-upstash.md): bounds cost exposure on this one route --
  // the only one in apps/api that calls a paid/metered AI provider. A no-op (no Redis call) when
  // Upstash env vars are unset, the default local-dev state.
  @Post()
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  async ask(@Body() body: AskRequestBody): Promise<Answer> {
    const question = typeof body?.question === 'string' ? body.question : '';
    const trimmedQuestion = question.trim();
    if (trimmedQuestion.length === 0) {
      throw new BadRequestException('question is required and must not be blank');
    }
    // A malformed/absent paperNumber/paperTitle degrades to "no paper context" rather than a 400
    // (this story's Boundaries/I/O matrix) -- these fields are client-controlled (our own quill
    // panel), not end-user-typed. paperNumber is a positive-integer check (matching the domain --
    // zero, negative, and fractional values are equally nonsensical as a paper number), and
    // paperTitle must be a non-empty string after trimming. Both must be independently valid for
    // `currentPaper` to be built at all -- "only paperNumber" or "only paperTitle" is treated the
    // same as neither (this field pair is prompt context only, never a retrieval filter --
    // product correction, 2026-09-02, see the spec's Spec Change Log).
    const isValidPaperNumber =
      typeof body?.paperNumber === 'number' &&
      Number.isInteger(body.paperNumber) &&
      body.paperNumber > 0;
    const trimmedPaperTitle =
      typeof body?.paperTitle === 'string' ? body.paperTitle.trim() : '';
    const currentPaper =
      isValidPaperNumber && trimmedPaperTitle.length > 0
        ? { paperNumber: body.paperNumber as number, title: trimmedPaperTitle }
        : undefined;

    const history = coerceHistory(body?.history);

    // Forward the already-validated, trimmed value -- not the raw `question` -- so
    // leading/trailing whitespace never reaches retrieval/the LLM/the request log. `history` is
    // only ever passed when non-empty -- an absent/malformed/empty field degrades to calling
    // AskService.ask exactly as before this story, byte-for-byte (this story's Boundaries).
    return history.length > 0
      ? this.askService.ask(trimmedQuestion, currentPaper, history)
      : this.askService.ask(trimmedQuestion, currentPaper);
  }
}
