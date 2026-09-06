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
});
