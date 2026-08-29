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
    expect(service.ask).toHaveBeenCalledWith('Why checks and balances?');
  });

  // Finding: the controller validated `question.trim().length === 0` but then forwarded the
  // original, untrimmed string to AskService.ask -- leading/trailing whitespace must never reach
  // retrieval/the LLM/the request log.
  it('forwards the trimmed question to AskService.ask, not the raw untrimmed value', async () => {
    service.ask.mockResolvedValue(fakeAnswer);

    await controller.ask({ question: '  Why checks and balances?  \n' });

    expect(service.ask).toHaveBeenCalledWith('Why checks and balances?');
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
});
