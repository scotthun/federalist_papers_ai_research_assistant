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

  // Story 5.2 (product-corrected 2026-09-02): the current paper is prompt context only, never a
  // restriction -- see the spec's Spec Change Log for why the original "hard filter" version of
  // this story was reverted.
  describe('currentPaper contextual note', () => {
    it('prepends a note naming the paper number and title before the QUESTION line when currentPaper is given', () => {
      const prompt = buildAnswerPrompt('question', [chunk()], undefined, {
        paperNumber: 10,
        title: 'The Same Subject Continued',
      });

      expect(prompt).toContain('Federalist No. 10');
      expect(prompt).toContain('The Same Subject Continued');
      expect(prompt.indexOf('Federalist No. 10')).toBeLessThan(prompt.indexOf('QUESTION:'));
    });

    it('explicitly tells the model the note is context only, not a restriction', () => {
      const prompt = buildAnswerPrompt('question', [chunk()], undefined, {
        paperNumber: 10,
        title: 'The Same Subject Continued',
      });

      expect(prompt.toLowerCase()).toMatch(/context only/);
      expect(prompt.toLowerCase()).toMatch(/any paper/);
    });

    it('omits the note entirely when currentPaper is absent', () => {
      const prompt = buildAnswerPrompt('question', [chunk()]);

      expect(prompt).not.toContain('currently reading');
    });

    it('combines correctly with a correction block (both present)', () => {
      const prompt = buildAnswerPrompt('question', [chunk()], 'fix your citations', {
        paperNumber: 10,
        title: 'The Same Subject Continued',
      });

      expect(prompt).toContain('CORRECTION: fix your citations');
      expect(prompt).toContain('Federalist No. 10');
    });
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
