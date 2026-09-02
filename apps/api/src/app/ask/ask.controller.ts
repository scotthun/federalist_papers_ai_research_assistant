import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { Answer } from '@federalist-research/shared';
import { AskService } from './ask.service';

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
  @Post()
  @HttpCode(200)
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

    // Forward the already-validated, trimmed value -- not the raw `question` -- so
    // leading/trailing whitespace never reaches retrieval/the LLM/the request log.
    return this.askService.ask(trimmedQuestion, currentPaper);
  }
}
