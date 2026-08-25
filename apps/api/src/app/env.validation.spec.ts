import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  it('throws a clear error when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('throws a clear error when DATABASE_URL is empty', () => {
    expect(() => validateEnv({ DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('throws a clear error when DATABASE_URL is not a postgres connection string', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'https://example.com' }),
    ).toThrow(/postgres/i);
  });

  it('throws a clear error when DATABASE_URL is not a valid URL at all', () => {
    expect(() => validateEnv({ DATABASE_URL: 'not-a-url' })).toThrow(
      /postgres/i,
    );
  });

  it('throws a clear error when DATABASE_URL has a postgres protocol but no host', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgres://' })).toThrow(
      /postgres/i,
    );
  });

  it('returns the parsed value for a valid postgres:// URL', () => {
    const url = 'postgres://federalist:federalist@localhost:5432/federalist_research';
    expect(validateEnv({ DATABASE_URL: url })).toEqual({ DATABASE_URL: url });
  });

  it('returns the parsed value for a valid postgresql:// URL', () => {
    const url = 'postgresql://federalist:federalist@localhost:5432/federalist_research';
    expect(validateEnv({ DATABASE_URL: url })).toEqual({ DATABASE_URL: url });
  });
});
