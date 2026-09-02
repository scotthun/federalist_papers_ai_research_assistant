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
    // Second argument is always passed (undefined when no paperNumber filter applies) -- Story
    // 5.2's addition.
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

  // Story 5.2: an optional `paperNumber` filter, threaded straight into AskService.ask's second
  // argument.
  describe('paperNumber (Story 5.2)', () => {
    it('forwards a numeric paperNumber as the service\'s second argument', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({ question: 'Why checks and balances?', paperNumber: 51 });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', 51);
    });

    it('calls the service with undefined when paperNumber is absent', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({ question: 'Why checks and balances?' });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    it('treats a non-numeric paperNumber as absent (undefined), not a 400', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({
        question: 'Why checks and balances?',
        paperNumber: 'fifty-one' as unknown as number,
      });

      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    it('treats a non-finite numeric paperNumber (NaN/Infinity) as absent, not a 400', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({ question: 'Why checks and balances?', paperNumber: NaN });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);

      await controller.ask({ question: 'Why checks and balances?', paperNumber: Infinity });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });

    // paperNumber ultimately becomes a bound SQL parameter matched against an integer column --
    // zero, negative, and fractional values are equally nonsensical as a paper number and must
    // degrade the same way as a non-number, never a 400 (this field is client-controlled, not
    // end-user-typed).
    it('treats zero, negative, and fractional paperNumbers as absent, not a 400', async () => {
      service.ask.mockResolvedValue(fakeAnswer);

      await controller.ask({ question: 'Why checks and balances?', paperNumber: 0 });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);

      await controller.ask({ question: 'Why checks and balances?', paperNumber: -51 });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);

      await controller.ask({ question: 'Why checks and balances?', paperNumber: 51.5 });
      expect(service.ask).toHaveBeenCalledWith('Why checks and balances?', undefined);
    });
  });
});
