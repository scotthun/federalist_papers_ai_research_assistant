import {
  createPaperReferenceExtractor,
  RegexPaperReferenceExtractor,
} from './paper-reference-extractor';

describe('RegexPaperReferenceExtractor', () => {
  const extractor = new RegexPaperReferenceExtractor();

  it.each([
    ['what is paper 4 about?', [4]],
    ['what is Paper 4 about?', [4]],
    ['what is PAPER 4 about?', [4]],
    ['can you summarize paper no. 4 of the federalist papers?', [4]],
    ['can you summarize paper #4?', [4]],
    ['what does federalist 4 argue?', [4]],
    ['what does federalist no. 4 argue?', [4]],
    ['what does Federalist No. 4 argue?', [4]],
  ])('matches %j -> %j', async (question, expected) => {
    await expect(extractor.extractPaperNumbers(question)).resolves.toEqual(expected);
  });

  it('matches multiple references in one question, in first-seen order', async () => {
    await expect(extractor.extractPaperNumbers('Compare papers 4 and 6')).resolves.toEqual([
      4, 6,
    ]);
  });

  it('matches a comma-and-"and" separated list of references', async () => {
    await expect(
      extractor.extractPaperNumbers('What do papers 1, 4, and 6 have in common?'),
    ).resolves.toEqual([1, 4, 6]);
  });

  it('matches a bare comma-separated list with no trailing "and"', async () => {
    await expect(extractor.extractPaperNumbers('Compare papers 4, 6')).resolves.toEqual([4, 6]);
  });

  it('deduplicates the same paper number referenced more than once', async () => {
    await expect(
      extractor.extractPaperNumbers('Tell me about paper 4 -- yes, paper 4 specifically.'),
    ).resolves.toEqual([4]);
  });

  it('excludes an out-of-range paper number (above the valid 1-85 range)', async () => {
    await expect(extractor.extractPaperNumbers('what is paper 200 about?')).resolves.toEqual([]);
  });

  it('excludes paper 0 (below the valid range)', async () => {
    await expect(extractor.extractPaperNumbers('what is paper 0 about?')).resolves.toEqual([]);
  });

  it('never produces a negative paper number (the leading "-" is not part of the matched digits)', async () => {
    await expect(extractor.extractPaperNumbers('what is paper -1 about?')).resolves.toEqual([]);
  });

  it('returns an empty array for a question with no paper-number reference at all', async () => {
    await expect(
      extractor.extractPaperNumbers('Why did the framers want checks and balances?'),
    ).resolves.toEqual([]);
  });

  it('does not match an unrelated lowercase "no" followed by a number', async () => {
    await expect(
      extractor.extractPaperNumbers('I have no 4-hour meetings today.'),
    ).resolves.toEqual([]);
  });

  it('keeps in-range numbers while still dropping an out-of-range one in the same question', async () => {
    await expect(
      extractor.extractPaperNumbers('Compare paper 4 to the fictional paper 200'),
    ).resolves.toEqual([4]);
  });
});

describe('createPaperReferenceExtractor', () => {
  it('returns a RegexPaperReferenceExtractor', () => {
    expect(createPaperReferenceExtractor()).toBeInstanceOf(RegexPaperReferenceExtractor);
  });
});
