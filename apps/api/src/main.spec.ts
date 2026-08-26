import { parsePort } from './main';

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
