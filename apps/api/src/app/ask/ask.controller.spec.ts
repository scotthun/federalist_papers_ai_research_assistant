import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Answer } from '@federalist-research/shared';
import { AskController, coerceHistory } from './ask.controller';
import { AskService } from './ask.service';

describe('AskController', () => {
  let controller: AskController;
  let service: { ask: jest.Mock };

  const fakeAnswer: Answer = {
    answer: 'Because ambition must be made to counteract ambition.',
    citations: [{ paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId: 'chunk-1' }],
    confidence: 'high',
    insufficientEvidence: false,
  };

  beforeEach(async () => {
    service = { ask: jest.fn() };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AskController],
      providers: [{ provide: AskService, useValue: service }],
    }).compile();

    controller = app.get<AskController>(AskController);
  });

  it('delegates to AskService.ask with the question and returns its result', async () => {
    service.ask.mockResolvedValue(fakeAnswer);

    await expect(controller.ask({ question: 'Why checks and balances?' })).resolves.toEqual(
      fakeAnswer,
    );
    // Second argument (currentPaper, Story 5.2) is always passed, undefined when no paper
    // context applies.
    expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
  });

  // Finding: the controller validated `question.trim().length === 0` but then forwarded the
  // original, untrimmed string to AskService.ask -- leading/trailing whitespace must never reach
  // retrieval/the LLM/the request log.
  it('forwards the trimmed question to AskService.ask, not the raw untrimmed value', async () => {
    service.ask.mockResolvedValue(fakeAnswer);

    await controller.ask({ question: '  Why checks and balances?  \n' });

    expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
  });

  // This story's I/O Edge-Case Matrix: "Blank/whitespace question ... 400 ... Never reaches
  // retrieval or the LLM." Checked here, at the controller, before AskService.ask is ever called.
  it('throws BadRequestException for a blank question without calling the service', async () => {
    await expect(controller.ask({ question: '' })).rejects.toBeInstanceOf(BadRequestException);
    expect(service.ask).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for a whitespace-only question without calling the service', async () => {
    await expect(controller.ask({ question: '   \n\t  ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.ask).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when question is absent without calling the service', async () => {
    await expect(controller.ask({})).rejects.toBeInstanceOf(BadRequestException);
    expect(service.ask).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when question is not a string without calling the service', async () => {
    await expect(
      controller.ask({ question: 12345 as unknown as string }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.ask).not.toHaveBeenCalled();
  });

  // Story 5.2 (product-corrected 2026-09-02): an optional `{ paperNumber, paperTitle }` pair,
  // threaded straight into AskService.ask's second argument as prompt context -- never a
  // retrieval filter. Both fields must independently validate for `currentPaper` to be built at
  // all.
  describe('currentPaper: paperNumber + paperTitle (Story 5.2)', () => {
    it('forwards a currentPaper object when both paperNumber and paperTitle are valid', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Why checks and balances?',
        paperNumber: 51,
        paperTitle: 'The Structure of the Government',
      });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', {
        paperNumber: 51,
        title: 'The Structure of the Government',
      });
    });

    it('trims paperTitle before including it in currentPaper', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Why checks and balances?',
        paperNumber: 51,
        paperTitle: '  The Structure of the Government  \n',
      });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', {
        paperNumber: 51,
        title: 'The Structure of the Government',
      });
    });

    it('calls the service with undefined when both paperNumber and paperTitle are absent', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({ question: 'Why checks and balances?' });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    it('treats paperNumber present without paperTitle as no context at all, not a 400', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({ question: 'Why checks and balances?', paperNumber: 51 });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    it('treats paperTitle present without paperNumber as no context at all, not a 400', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Why checks and balances?',
        paperTitle: 'The Structure of the Government',
      });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    it('treats a non-numeric paperNumber as invalid, degrading to no context, not a 400', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Why checks and balances?',
        paperNumber: 'fifty-one' as unknown as number,
        paperTitle: 'The Structure of the Government',
      });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    it('treats a non-finite numeric paperNumber (NaN/Infinity) as invalid, not a 400', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Why checks and balances?',
        paperNumber: NaN,
        paperTitle: 'The Structure of the Government',
      });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);

      await controller.ask({
        question: 'Why checks and balances?',
        paperNumber: Infinity,
        paperTitle: 'The Structure of the Government',
      });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    // paperNumber is checked against the domain (a real paper number) even though it's no longer
    // a SQL bound parameter -- zero, negative, and fractional values are equally nonsensical as a
    // paper number and must degrade the same way as a non-number, never a 400.
    it('treats zero, negative, and fractional paperNumbers as invalid, not a 400', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Why checks and balances?',
        paperNumber: 0,
        paperTitle: 'The Structure of the Government',
      });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);

      await controller.ask({
        question: 'Why checks and balances?',
        paperNumber: -51,
        paperTitle: 'The Structure of the Government',
      });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);

      await controller.ask({
        question: 'Why checks and balances?',
        paperNumber: 51.5,
        paperTitle: 'The Structure of the Government',
      });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    it('treats a non-string or blank/whitespace-only paperTitle as invalid, not a 400', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Why checks and balances?',
        paperNumber: 51,
        paperTitle: 12345 as unknown as string,
      });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);

      await controller.ask({
        question: 'Why checks and balances?',
        paperNumber: 51,
        paperTitle: '   \n\t  ',
      });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });
  });

  // spec-conversation-history-context.md: an optional `history` array of prior question/answer
  // pairs, sent by the quill panel on every ask. Validated/coerced defensively -- a malformed
  // entry or field is never a 400 (this story's Boundaries).
  describe('history (spec-conversation-history-context.md)', () => {
    it('calls the service with a two-argument call (no history) when history is absent -- byte-for-byte unchanged', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({ question: 'Why checks and balances?' });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    it('forwards a valid history array, oldest first, as the third argument', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Can you compare and contrast these two papers?',
        history: [
          { question: 'Which papers discuss factions?', answer: 'No. 10 and No. 51.' },
          { question: 'Which one is most similar to No. 6?', answer: 'No. 8.' },
        ],
      });

      expect(service.ask).toHaveBeenCalledWith(
        'Can you compare and contrast these two papers?',
        undefined,
        [
          { question: 'Which papers discuss factions?', answer: 'No. 10 and No. 51.' },
          { question: 'Which one is most similar to No. 6?', answer: 'No. 8.' },
        ],
      );
    });

    it('treats a non-array history as absent, not a 400', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Why checks and balances?',
        history: 'not an array' as unknown as unknown[],
      });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    it('drops malformed entries (missing/non-string question or answer) rather than rejecting the whole field', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Why checks and balances?',
        history: [
          { question: 'Which papers discuss factions?', answer: 'No. 10 and No. 51.' },
          { question: 'missing answer' },
          { question: 123, answer: 'non-string question' },
          'not even an object',
          null,
        ] as unknown as unknown[],
      });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined, [
        { question: 'Which papers discuss factions?', answer: 'No. 10 and No. 51.' },
      ]);
    });

    it('treats a history array with zero valid entries as absent, not an empty-array third argument', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Why checks and balances?',
        history: [{ bogus: true }] as unknown as unknown[],
      });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    it('never throws BadRequestException for a malformed history field', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await expect(
        controller.ask({
          question: 'Why checks and balances?',
          history: { not: 'an array' } as unknown as unknown[],
        }),
      ).resolves.toEqual(fakeAnswer);
    });

    // The shipped default is HISTORY_MAX_TURNS === null (no cap) -- this proves the rollback path
    // (flipping it to a number) already works correctly, without needing to actually flip the
    // shipped constant (this story's I/O matrix: "exercised by a test even though the shipped
    // default is null, so the rollback path is proven to work before it's ever needed").
    describe('HISTORY_MAX_TURNS rollback path (coerceHistory)', () => {
      const fiveTurns = [
        { question: 'Q1', answer: 'A1' },
        { question: 'Q2', answer: 'A2' },
        { question: 'Q3', answer: 'A3' },
        { question: 'Q4', answer: 'A4' },
        { question: 'Q5', answer: 'A5' },
      ];

      it('keeps every valid turn when maxTurns is null (the shipped default)', () => {
        expect(coerceHistory(fiveTurns, null)).toEqual(fiveTurns);
      });

      it('keeps only the most recent maxTurns turns when set to a number', () => {
        expect(coerceHistory(fiveTurns, 3)).toEqual([
          { question: 'Q3', answer: 'A3' },
          { question: 'Q4', answer: 'A4' },
          { question: 'Q5', answer: 'A5' },
        ]);
      });

      it('is a no-op when the conversation has not yet grown past the cap', () => {
        expect(coerceHistory(fiveTurns, 10)).toEqual(fiveTurns);
      });

      it('applies the cap after dropping malformed entries, not before', () => {
        const withOneMalformed = [
          { question: 'Q1', answer: 'A1' },
          { bogus: true },
          { question: 'Q2', answer: 'A2' },
          { question: 'Q3', answer: 'A3' },
        ];

        expect(coerceHistory(withOneMalformed, 2)).toEqual([
          { question: 'Q2', answer: 'A2' },
          { question: 'Q3', answer: 'A3' },
        ]);
      });
    });
  });
});
