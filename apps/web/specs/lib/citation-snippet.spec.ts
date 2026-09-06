import {
  CITATION_SNIPPET_MAX_LENGTH,
  truncateCitationSnippet,
} from '../../src/lib/citation-snippet';

describe('truncateCitationSnippet', () => {
  it('returns a passage shorter than the cap unchanged, with no ellipsis', () => {
    const passage = 'Ambition must counteract ambition.';

    expect(truncateCitationSnippet(passage)).toBe(passage);
  });

  it('returns a passage exactly at the cap unchanged', () => {
    const passage = 'a'.repeat(CITATION_SNIPPET_MAX_LENGTH);

    expect(truncateCitationSnippet(passage)).toBe(passage);
  });

  it('truncates a passage longer than the cap and appends an ellipsis', () => {
    const passage = 'a'.repeat(CITATION_SNIPPET_MAX_LENGTH + 20);

    const result = truncateCitationSnippet(passage);

    expect(result).toBe(`${'a'.repeat(CITATION_SNIPPET_MAX_LENGTH)}…`);
    expect(result.length).toBe(CITATION_SNIPPET_MAX_LENGTH + 1);
  });

  it('trims trailing whitespace left at the truncation boundary before the ellipsis', () => {
    const passage = `${'a'.repeat(CITATION_SNIPPET_MAX_LENGTH - 1)} b`;

    const result = truncateCitationSnippet(passage);

    expect(result).toBe(`${'a'.repeat(CITATION_SNIPPET_MAX_LENGTH - 1)}…`);
  });

  it('honors a custom maxLength override', () => {
    expect(truncateCitationSnippet('abcdefghij', 5)).toBe('abcde…');
  });

  // spec-chat-nice-to-haves.md: word-boundary-aware truncation.
  it('backs up to the last word boundary rather than cutting a word in half', () => {
    // A naive hard cut at 10 chars would land mid-word ("Hello wond…").
    const result = truncateCitationSnippet('Hello wonderful world', 10);

    expect(result).toBe('Hello…');
  });

  it('falls back to a hard cut when there is no space anywhere in the cut region', () => {
    const passage = 'a'.repeat(20);

    const result = truncateCitationSnippet(passage, 10);

    expect(result).toBe(`${'a'.repeat(10)}…`);
  });
});
