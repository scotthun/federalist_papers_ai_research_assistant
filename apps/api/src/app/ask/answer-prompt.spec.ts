import type { RetrievedChunk } from '@federalist-research/retrieval';
import {
  ANSWER_SYSTEM_INSTRUCTION,
  buildAnswerPrompt,
  buildInvalidCitationCorrection,
  buildInvalidOutputCorrection,
} from './answer-prompt';

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: 'chunk-1',
    paperNumber: 51,
    paperTitle: 'The Structure of the Government',
    content: 'Ambition must be made to counteract ambition.',
    score: 0.8,
    ...overrides,
  };
}

describe('ANSWER_SYSTEM_INSTRUCTION', () => {
  it('instructs the model to answer only from supplied evidence and never invent citations', () => {
    expect(ANSWER_SYSTEM_INSTRUCTION).toMatch(/ONLY/);
    expect(ANSWER_SYSTEM_INSTRUCTION.toLowerCase()).toMatch(/never invent/);
  });
});

describe('buildAnswerPrompt', () => {
  it('includes the question and every passage with its source metadata', () => {
    const prompt = buildAnswerPrompt('Why checks and balances?', [
      chunk({ chunkId: 'chunk-1', paperNumber: 51 }),
      chunk({ chunkId: 'chunk-2', paperNumber: 10, content: 'Factions are the mischief.' }),
    ]);

    expect(prompt).toContain('Why checks and balances?');
    expect(prompt).toContain('chunkId=chunk-1');
    expect(prompt).toContain('paperNumber=51');
    expect(prompt).toContain('Ambition must be made to counteract ambition.');
    expect(prompt).toContain('chunkId=chunk-2');
    expect(prompt).toContain('Factions are the mischief.');
  });

  it('includes an explicit "answer only from this evidence" instruction', () => {
    const prompt = buildAnswerPrompt('question', [chunk()]);

    expect(prompt.toLowerCase()).toMatch(/answer only from the evidence/);
  });

  it('omits any correction block when no correction is given', () => {
    const prompt = buildAnswerPrompt('question', [chunk()]);

    expect(prompt).not.toContain('CORRECTION');
  });

  it('appends the correction block verbatim when given (the one-retry path)', () => {
    const prompt = buildAnswerPrompt('question', [chunk()], 'fix your citations');

    expect(prompt).toContain('CORRECTION: fix your citations');
  });
});

describe('buildInvalidCitationCorrection', () => {
  it('names the invalid chunkId(s) and the full valid set', () => {
    const correction = buildInvalidCitationCorrection(['chunk-999'], ['chunk-1', 'chunk-2']);

    expect(correction).toContain('chunk-999');
    expect(correction).toContain('chunk-1');
    expect(correction).toContain('chunk-2');
  });
});

describe('buildInvalidOutputCorrection', () => {
  it('includes the original parse/validation error message', () => {
    const correction = buildInvalidOutputCorrection('answer: Required');

    expect(correction).toContain('answer: Required');
  });
});
