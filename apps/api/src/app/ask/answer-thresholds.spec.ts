import { CLARIFY_THRESHOLD, CONFIDENT_THRESHOLD, decideAnswerTier } from './answer-thresholds';

describe('answer-thresholds calibrated constants', () => {
  // Pins the exact calibrated literals (this story's Design Notes/spec) -- every other test here
  // only checks relative ordering (CLARIFY_THRESHOLD < CONFIDENT_THRESHOLD), so a typo like 0.65
  // -> 0.065 would silently pass every other test in this file despite moving the real
  // confident/clarify boundary.
  it('pins CONFIDENT_THRESHOLD and CLARIFY_THRESHOLD to their calibrated values', () => {
    expect(CONFIDENT_THRESHOLD).toBe(0.65);
    expect(CLARIFY_THRESHOLD).toBe(0.55);
  });
});

describe('decideAnswerTier', () => {
  it('is confident at exactly CONFIDENT_THRESHOLD', () => {
    expect(decideAnswerTier(CONFIDENT_THRESHOLD)).toBe('confident');
  });

  it('is confident above CONFIDENT_THRESHOLD', () => {
    expect(decideAnswerTier(CONFIDENT_THRESHOLD + 0.1)).toBe('confident');
  });

  it('is clarify just below CONFIDENT_THRESHOLD', () => {
    expect(decideAnswerTier(CONFIDENT_THRESHOLD - 0.001)).toBe('clarify');
  });

  it('is clarify at exactly CLARIFY_THRESHOLD', () => {
    expect(decideAnswerTier(CLARIFY_THRESHOLD)).toBe('clarify');
  });

  it('is refuse just below CLARIFY_THRESHOLD', () => {
    expect(decideAnswerTier(CLARIFY_THRESHOLD - 0.001)).toBe('refuse');
  });

  it('is refuse for a very low/negative score', () => {
    expect(decideAnswerTier(-0.5)).toBe('refuse');
  });

  it('is refuse when no chunk was retrieved at all', () => {
    expect(decideAnswerTier(undefined)).toBe('refuse');
  });

  it('keeps CLARIFY_THRESHOLD strictly below CONFIDENT_THRESHOLD, so the clarify band is non-empty', () => {
    expect(CLARIFY_THRESHOLD).toBeLessThan(CONFIDENT_THRESHOLD);
  });
});
