import { render, screen } from '@testing-library/react';
import type { PaperSummary } from '@federalist-research/shared';
import Page from '../src/app/page';

/**
 * Page is an async Server Component (fetches PaperSummary[] from apps/api). It's still a plain
 * async function under the hood, so it can be invoked directly and the resulting element tree
 * rendered with plain @testing-library/react -- no Next.js request/router harness required.
 * Covers this story's I/O & Edge-Case Matrix: real data (incl. joint authorship), empty
 * database, and an unreachable API.
 *
 * Assertions use only jest's built-in matchers (no @testing-library/jest-dom) -- not a
 * dependency named in stack.md / the architecture spine / this spec, so not introduced here.
 * The getBy-prefixed queries already throw (failing the test) when nothing matches, and the
 * queryBy-prefixed ones return null when nothing matches -- enough to assert presence/absence
 * without it.
 */
const originalFetch = global.fetch;
const originalApiBaseUrl = process.env.API_BASE_URL;

/** Always resolves (not resolves-once, despite similarly-named jest APIs) -- named for what it
 * actually does. */
function mockFetchResolved(init: { ok: boolean; status: number; body: unknown }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status,
    json: () => Promise.resolve(init.body),
  }) as unknown as typeof fetch;
}

describe('Browse Papers page', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.API_BASE_URL = originalApiBaseUrl;
    jest.resetAllMocks();
  });

  it('renders the "Federalist Research" header and subtitle', async () => {
    mockFetchResolved({ ok: true, status: 200, body: [] });

    render(await Page());

    expect(
      screen.getByRole('heading', { level: 1, name: 'Federalist Research' }),
    ).toBeTruthy();
    expect(
      screen.getByText('Explore the Federalist Papers with source-grounded AI.'),
    ).toBeTruthy();
  });

  it('fetches from the default API base URL with no-store caching', async () => {
    delete process.env.API_BASE_URL;
    mockFetchResolved({ ok: true, status: 200, body: [] });

    await Page();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3333/api/papers',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('honors an API_BASE_URL override', async () => {
    process.env.API_BASE_URL = 'https://example.test/api';
    mockFetchResolved({ ok: true, status: 200, body: [] });

    await Page();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.test/api/papers',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('strips a trailing slash from API_BASE_URL before appending the path', async () => {
    process.env.API_BASE_URL = 'https://example.test/api/';
    mockFetchResolved({ ok: true, status: 200, body: [] });

    await Page();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.test/api/papers',
      expect.anything(),
    );
  });

  it('lists every paper with its number, title, and every credited author, each linking to its reader route', async () => {
    const papers: PaperSummary[] = [
      { paperNumber: 1, title: 'General Introduction', authors: ['Hamilton'] },
      {
        paperNumber: 18,
        title: 'The Utility of the Union as a Safeguard',
        authors: ['Hamilton', 'Madison'],
      },
    ];
    mockFetchResolved({ ok: true, status: 200, body: papers });

    render(await Page());

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);

    expect(
      screen.getByRole('link', { name: /General Introduction/ }).getAttribute('href'),
    ).toBe('/papers/1');
    expect(screen.getByText('Hamilton')).toBeTruthy();

    // Joint authorship (Papers 18-20, 62-63): every credited author shown, never a single pick.
    expect(
      screen
        .getByRole('link', { name: /The Utility of the Union as a Safeguard/ })
        .getAttribute('href'),
    ).toBe('/papers/18');
    expect(screen.getByText('Hamilton, Madison')).toBeTruthy();
  });

  it('renders a fallback when a paper has no credited authors', async () => {
    const papers: PaperSummary[] = [
      { paperNumber: 1, title: 'General Introduction', authors: [] },
    ];
    mockFetchResolved({ ok: true, status: 200, body: papers });

    render(await Page());

    expect(screen.getByText('Unknown author')).toBeTruthy();
  });

  it('renders a clear empty state, without crashing, when no papers have been ingested', async () => {
    mockFetchResolved({ ok: true, status: 200, body: [] });

    render(await Page());

    expect(screen.getByText(/No papers have been ingested yet/i)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a clear error state, without crashing, when the API cannot be reached', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    render(await Page());

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a clear error state when the API responds with a non-2xx status', async () => {
    mockFetchResolved({ ok: false, status: 500, body: {} });

    render(await Page());

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders a clear error state when the API responds 2xx with a non-array body', async () => {
    mockFetchResolved({ ok: true, status: 200, body: { unexpected: 'shape' } });

    render(await Page());

    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
