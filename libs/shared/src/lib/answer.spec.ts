import { AnswerSchema, CitationSchema, LlmAnswerOutputSchema } from './answer';

describe('CitationSchema', () => {
  const validCitation = {
    paperNumber: 51,
    paperTitle: 'The Structure of the Government Must Furnish the Proper Checks and Balances',
    chunkId: 'chunk-1',
  };

  it('accepts a citation with only the required fields', () => {
    expect(CitationSchema.safeParse(validCitation).success).toBe(true);
  });

  it('accepts a citation with quotedPassage and relevanceExplanation present', () => {
    const result = CitationSchema.safeParse({
      ...validCitation,
      quotedPassage: 'Ambition must be made to counteract ambition.',
      relevanceExplanation: 'Directly answers the checks-and-balances question.',
    });

    expect(result.success).toBe(true);
  });

  it('rejects a citation missing a required field', () => {
    const withoutPaperNumber = { paperTitle: validCitation.paperTitle, chunkId: validCitation.chunkId };
    expect(CitationSchema.safeParse(withoutPaperNumber).success).toBe(false);
  });

  it('rejects a non-string chunkId', () => {
    expect(
      CitationSchema.safeParse({ ...validCitation, chunkId: 1 }).success,
    ).toBe(false);
  });
});

describe('LlmAnswerOutputSchema', () => {
  it('accepts exactly { answer, citations } -- the only shape ever requested from the LLM', () => {
    const result = LlmAnswerOutputSchema.safeParse({
      answer: 'Because ambition must be made to counteract ambition.',
      citations: [
        { paperNumber: 51, paperTitle: 'Federalist No. 51', chunkId: 'chunk-1' },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('accepts an empty citations array', () => {
    expect(
      LlmAnswerOutputSchema.safeParse({ answer: 'An answer.', citations: [] }).success,
    ).toBe(true);
  });

  it('does not define confidence or insufficientEvidence fields -- those are never requested from the LLM', () => {
    expect(Object.keys(LlmAnswerOutputSchema.shape)).toEqual(['answer', 'citations']);
  });

  it('rejects a missing answer field', () => {
    expect(LlmAnswerOutputSchema.safeParse({ citations: [] }).success).toBe(false);
  });
});

describe('AnswerSchema', () => {
  const baseAnswer = {
    answer: 'Because ambition must be made to counteract ambition.',
    citations: [],
    insufficientEvidence: false,
  };

  it('accepts confidence: "high"', () => {
    expect(
      AnswerSchema.safeParse({ ...baseAnswer, confidence: 'high' }).success,
    ).toBe(true);
  });

  it('accepts confidence: "low"', () => {
    expect(
      AnswerSchema.safeParse({ ...baseAnswer, confidence: 'low' }).success,
    ).toBe(true);
  });

  it('accepts confidence: "medium" -- schema-valid even though no tier produces it today', () => {
    expect(
      AnswerSchema.safeParse({ ...baseAnswer, confidence: 'medium' }).success,
    ).toBe(true);
  });

  it('rejects an arbitrary confidence value', () => {
    expect(
      AnswerSchema.safeParse({ ...baseAnswer, confidence: 'certain' }).success,
    ).toBe(false);
  });

  it('rejects a missing insufficientEvidence field', () => {
    const withoutFlag = { answer: baseAnswer.answer, citations: baseAnswer.citations };
    expect(
      AnswerSchema.safeParse({ ...withoutFlag, confidence: 'high' }).success,
    ).toBe(false);
  });

  it('composes CitationSchema for each entry in citations', () => {
    const result = AnswerSchema.safeParse({
      ...baseAnswer,
      confidence: 'high',
      citations: [{ paperNumber: 51, paperTitle: 'Federalist No. 51' }],
    });

    expect(result.success).toBe(false);
  });
});
