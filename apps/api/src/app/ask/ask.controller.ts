import { BadRequestException, Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { Answer } from '@federalist-research/shared';
import { AskService } from './ask.service';

/** Loose on purpose: the request body is untrusted input, not yet known to actually contain a
 *  string `question` -- `ask` below is what turns it into a validated, guaranteed-non-blank
 *  string before anything else (retrieval, the LLM) ever runs. */
export interface AskRequestBody {
  question?: unknown;
  /** Optional retrieval filter (Story 5.2) -- set by the quill widget only when its context chip
   *  is showing (client-controlled, not end-user-typed). Anything other than a positive integer
   *  (non-number, NaN/Infinity, zero, negative, or fractional) is treated as absent (no filter, no
   *  error), never a 400 -- see `ask()`'s coercion below. */
  paperNumber?: unknown;
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
    // A malformed/absent paperNumber degrades to "search the whole archive" rather than a 400
    // (this story's Boundaries/I/O matrix) -- this field is client-controlled (our own quill
    // panel), not end-user-typed. `paperNumber` ultimately becomes a bound SQL parameter matched
    // against an integer column (libs/retrieval's `paper.paper_number = $N`), so this is a
    // positive-integer check, not just "any finite number" -- zero, negative, and fractional
    // values are equally nonsensical as a paper number and degrade the same way.
    const paperNumber =
      typeof body?.paperNumber === 'number' &&
      Number.isInteger(body.paperNumber) &&
      body.paperNumber > 0
        ? body.paperNumber
        : undefined;

    // Forward the already-validated, trimmed value -- not the raw `question` -- so
    // leading/trailing whitespace never reaches retrieval/the LLM/the request log.
    return this.askService.ask(trimmedQuestion, paperNumber);
  }
}
