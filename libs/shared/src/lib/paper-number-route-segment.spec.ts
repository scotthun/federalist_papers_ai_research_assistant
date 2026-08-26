import { parsePaperNumberRouteSegment } from './paper-number-route-segment';

describe('parsePaperNumberRouteSegment', () => {
  it('parses a plain decimal integer', () => {
    expect(parsePaperNumberRouteSegment('1')).toBe(1);
    expect(parsePaperNumberRouteSegment('999')).toBe(999);
  });

  it('parses a negative plain decimal integer', () => {
    expect(parsePaperNumberRouteSegment('-1')).toBe(-1);
  });

  it('rejects non-numeric text', () => {
    expect(parsePaperNumberRouteSegment('abc')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parsePaperNumberRouteSegment('')).toBeNull();
  });

  it('rejects hex notation, which Number() would otherwise silently accept', () => {
    expect(parsePaperNumberRouteSegment('0x10')).toBeNull();
  });

  it('rejects exponential notation, which Number() would otherwise silently accept', () => {
    expect(parsePaperNumberRouteSegment('1e2')).toBeNull();
  });

  it('rejects a decimal fraction, even one that is numerically a whole number', () => {
    expect(parsePaperNumberRouteSegment('1.0')).toBeNull();
    expect(parsePaperNumberRouteSegment('1.5')).toBeNull();
  });

  it('rejects a leading "+"', () => {
    expect(parsePaperNumberRouteSegment('+1')).toBeNull();
  });

  it('rejects whitespace padding', () => {
    expect(parsePaperNumberRouteSegment(' 1 ')).toBeNull();
    expect(parsePaperNumberRouteSegment('1\n')).toBeNull();
  });
});
