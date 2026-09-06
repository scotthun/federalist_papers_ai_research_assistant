import type { RetrievedChunk } from '@federalist-research/retrieval';
import {
  ANSWER_SYSTEM_INSTRUCTION,
  buildAnswerPrompt,
  buildInvalidCitationCorrection,
  buildInvalidOutputCorrection,
  buildRetrievalQuery,
  type ConversationTurn,
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

// spec-conversation-history-context.md: threads the full prior conversation into the generation
// prompt as a "CONVERSATION SO FAR" block, clearly separated from EVIDENCE and never a citation
// source.
describe('buildAnswerPrompt: CONVERSATION SO FAR block (spec-conversation-history-context.md)', () => {
  const history: ConversationTurn[] = [
    { question: 'Which papers discuss factions?', answer: 'No. 10 and No. 51 discuss factions.' },
    { question: 'Which one is most similar to No. 6?', answer: 'No. 8 is most similar to No. 6.' },
  ];

  it('omits the CONVERSATION SO FAR block entirely when history is empty/absent', () => {
    const promptWithoutArg = buildAnswerPrompt('question', [chunk()]);
    const promptWithEmptyArray = buildAnswerPrompt('question', [chunk()], undefined, undefined, []);

    expect(promptWithoutArg).not.toContain('CONVERSATION SO FAR');
    expect(promptWithEmptyArray).not.toContain('CONVERSATION SO FAR');
    // Byte-for-byte identical to the no-history-param case -- this story's "existing single-turn
    // behavior is byte-for-byte unchanged" boundary.
    expect(promptWithEmptyArray).toBe(promptWithoutArg);
  });

  it('renders every turn, oldest first, before EVIDENCE:', () => {
    const prompt = buildAnswerPrompt('Compare and contrast these two papers.', [chunk()], undefined, undefined, history);

    expect(prompt).toContain('CONVERSATION SO FAR');
    expect(prompt).toContain('Which papers discuss factions?');
    expect(prompt).toContain('No. 10 and No. 51 discuss factions.');
    expect(prompt).toContain('Which one is most similar to No. 6?');
    expect(prompt).toContain('No. 8 is most similar to No. 6.');
    expect(prompt.indexOf('CONVERSATION SO FAR')).toBeLessThan(prompt.indexOf('EVIDENCE:'));
    // Oldest first: the first turn's question appears before the second turn's question.
    expect(prompt.indexOf('Which papers discuss factions?')).toBeLessThan(
      prompt.indexOf('Which one is most similar to No. 6?'),
    );
  });

  it('makes clear the block is context only, never a citation source', () => {
    const prompt = buildAnswerPrompt('question', [chunk()], undefined, undefined, history);

    expect(prompt.toLowerCase()).toMatch(/context only/);
    expect(prompt.toLowerCase()).toMatch(/not evidence/);
  });

  it('combines correctly with a correction block and a currentPaper note (all present at once)', () => {
    const prompt = buildAnswerPrompt(
      'question',
      [chunk()],
      'fix your citations',
      { paperNumber: 10, title: 'The Same Subject Continued' },
      history,
    );

    expect(prompt).toContain('CONVERSATION SO FAR');
    expect(prompt).toContain('CORRECTION: fix your citations');
    expect(prompt).toContain('Federalist No. 10');
  });
});

describe('ANSWER_SYSTEM_INSTRUCTION: conversation history is never a citation source', () => {
  it('tells the model history is context only, not evidence', () => {
    expect(ANSWER_SYSTEM_INSTRUCTION.toLowerCase()).toMatch(/conversation so far/);
    expect(ANSWER_SYSTEM_INSTRUCTION.toLowerCase()).toMatch(/never a source of evidence/);
  });
});

describe('buildRetrievalQuery', () => {
  it('returns the raw question unchanged when history is empty', () => {
    expect(buildRetrievalQuery('Why checks and balances?', [])).toBe(
      'Why checks and balances?',
    );
  });

  it('concatenates only the immediately preceding turn with the new question, not the full history', () => {
    const history: ConversationTurn[] = [
      { question: 'Which papers discuss factions?', answer: 'No. 10 and No. 51.' },
      { question: 'Which one is most similar to No. 6?', answer: 'No. 8 is most similar to No. 6.' },
    ];

    const query = buildRetrievalQuery('Can you compare and contrast these two papers?', history);

    expect(query).toContain('Which one is most similar to No. 6?');
    expect(query).toContain('No. 8 is most similar to No. 6.');
    expect(query).toContain('Can you compare and contrast these two papers?');
    // The older, less relevant turn is deliberately excluded -- keeps the embedding call's input
    // focused (this story's Boundaries).
    expect(query).not.toContain('Which papers discuss factions?');
    expect(query).not.toContain('No. 10 and No. 51.');
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
