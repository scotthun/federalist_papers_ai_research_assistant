import { resolveApiBaseUrl } from '../../src/lib/api-client';

/**
 * Direct unit coverage for the shared base-URL resolution extracted out of src/app/page.tsx and
 * src/app/papers/[paperNumber]/page.tsx (both pages' specs also exercise this indirectly through
 * their own fetch-URL assertions, but pinning it here means a regression is caught even if a
 * future page forgets to assert on the exact fetch URL).
 */
describe('resolveApiBaseUrl', () => {
  const originalApiBaseUrl = process.env.API_BASE_URL;

  afterEach(() => {
    process.env.API_BASE_URL = originalApiBaseUrl;
  });

  it('defaults to http://localhost:3333/api when API_BASE_URL is unset', () => {
    delete process.env.API_BASE_URL;

    expect(resolveApiBaseUrl()).toBe('http://localhost:3333/api');
  });

  it('honors an API_BASE_URL override', () => {
    process.env.API_BASE_URL = 'https://example.test/api';

    expect(resolveApiBaseUrl()).toBe('https://example.test/api');
  });

  it('strips a trailing slash', () => {
    process.env.API_BASE_URL = 'https://example.test/api/';

    expect(resolveApiBaseUrl()).toBe('https://example.test/api');
  });

  it('strips repeated trailing slashes', () => {
    process.env.API_BASE_URL = 'https://example.test/api///';

    expect(resolveApiBaseUrl()).toBe('https://example.test/api');
  });
});
