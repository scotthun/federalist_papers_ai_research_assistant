import { parsePort, resolveCorsOrigin } from './main';

describe('parsePort', () => {
  it('returns the default when PORT is unset', () => {
    expect(parsePort({}, 3333)).toBe(3333);
  });

  it('parses a valid PORT override', () => {
    expect(parsePort({ PORT: '4000' }, 3333)).toBe(4000);
  });

  it('throws a clear error when PORT is not an integer', () => {
    expect(() => parsePort({ PORT: 'not-a-number' }, 3333)).toThrow(/PORT/);
  });

  it('throws a clear error when PORT is zero', () => {
    expect(() => parsePort({ PORT: '0' }, 3333)).toThrow(/PORT/);
  });

  it('throws a clear error when PORT is negative', () => {
    expect(() => parsePort({ PORT: '-1' }, 3333)).toThrow(/PORT/);
  });

  it('throws a clear error when PORT is a non-integer number', () => {
    expect(() => parsePort({ PORT: '3333.5' }, 3333)).toThrow(/PORT/);
  });
});

// Story 4.1: WEB_ORIGIN-gated CORS -- unset means no CORS call at all (today's local-dev
// behavior, byte-for-byte unchanged), never a permissive/reflect-origin default.
describe('resolveCorsOrigin', () => {
  it('returns undefined when WEB_ORIGIN is unset (local dev, unchanged behavior)', () => {
    expect(resolveCorsOrigin({})).toBeUndefined();
  });

  it('returns the configured origin when WEB_ORIGIN is set', () => {
    expect(resolveCorsOrigin({ WEB_ORIGIN: 'https://example.com' })).toBe(
      'https://example.com',
    );
  });

  it('treats an empty-string WEB_ORIGIN the same as unset', () => {
    expect(resolveCorsOrigin({ WEB_ORIGIN: '' })).toBeUndefined();
  });

  it('treats a whitespace-only WEB_ORIGIN the same as unset', () => {
    expect(resolveCorsOrigin({ WEB_ORIGIN: '   ' })).toBeUndefined();
  });

  it('treats a literal "*" as unset rather than opening CORS to every origin', () => {
    expect(resolveCorsOrigin({ WEB_ORIGIN: '*' })).toBeUndefined();
  });

  it('trims surrounding whitespace from an otherwise-valid WEB_ORIGIN', () => {
    expect(resolveCorsOrigin({ WEB_ORIGIN: '  https://example.com  ' })).toBe(
      'https://example.com',
    );
  });
});
