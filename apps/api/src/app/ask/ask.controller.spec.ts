import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Answer } from '@federalist-research/shared';
import { AskController } from './ask.controller';
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
});
