import { render, screen } from '@testing-library/react';
import type { PaperDetail } from '@federalist-research/shared';
import Page from '../../../src/app/papers/[paperNumber]/page';

/**
 * Page is an async Server Component (fetches PaperDetail from apps/api). It's still a plain
 * async function under the hood, so it can be invoked directly and the resulting element tree
 * rendered with plain @testing-library/react -- same approach as specs/index.spec.tsx. Covers
 * this story's I/O & Edge-Case Matrix: valid paper, joint authorship, nonexistent paper number,
 * non-numeric route segment (including Number()-lenient lookalikes), and an unreachable API.
 */
const originalFetch = global.fetch;
const originalApiBaseUrl = process.env.API_BASE_URL;

// Next's notFound() throws a plain Error carrying this digest (confirmed by reading
// next/dist/client/components/not-found.js and http-access-fallback.js) -- asserting on it,
// rather than just `.rejects.toThrow()`, is what actually proves notFound() fired instead of some
// other unrelated throw (which would silently regress to Next's generic error boundary instead of
// a real 404 page, with no test catching it).
const NOT_FOUND_DIGEST = expect.objectContaining({
  digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK;404'),
});

function mockFetchResolved(init: { ok: boolean; status: number; body: unknown }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status,
    json: () => Promise.resolve(init.body),
  }) as unknown as typeof fetch;
}

function paramsFor(paperNumber: string) {
  return Promise.resolve({ paperNumber });
}

function searchParamsFor(q: string | string[]) {
  return Promise.resolve({ q });
}

describe('Paper Reader page', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.API_BASE_URL = originalApiBaseUrl;
    jest.resetAllMocks();
  });

  it('renders paper number, title, author(s), and full text with paragraph breaks preserved', async () => {
    const paper: PaperDetail = {
      paperNumber: 1,
      title: 'General Introduction',
      authors: ['Hamilton'],
      fullText: 'Paragraph one.\n\nParagraph two.',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
    };
    mockFetchResolved({ ok: true, status: 200, body: paper });

    render(await Page({ params: paramsFor('1') }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'General Introduction' }),
    ).toBeTruthy();
    expect(screen.getByText('No. 1')).toBeTruthy();
    expect(screen.getByText('Hamilton')).toBeTruthy();
    expect(screen.getByText('Paragraph one.')).toBeTruthy();
    expect(screen.getByText('Paragraph two.')).toBeTruthy();
  });

  it('filters out blank paragraphs produced by leading/trailing or repeated blank lines', async () => {
    const paper: PaperDetail = {
      paperNumber: 1,
      title: 'General Introduction',
      authors: ['Hamilton'],
      fullText: '\n\nParagraph one.\n\n\n\nParagraph two.\n\n',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
    };
    mockFetchResolved({ ok: true, status: 200, body: paper });

    render(await Page({ params: paramsFor('1') }));

    const paragraphs = screen
      .getAllByText(/Paragraph (one|two)\./)
      .map((el) => el.tagName);
    expect(paragraphs).toEqual(['P', 'P']);
    // Every rendered <p> has real text -- no stray empty ones from blank-line segments.
    document.querySelectorAll('article p').forEach((p) => {
      expect(p.textContent?.trim().length).toBeGreaterThan(0);
    });
  });

  it('shows every credited author for a jointly-authored paper, never an arbitrary single pick', async () => {
    const paper: PaperDetail = {
      paperNumber: 51,
      title: 'The Structure of the Government Must Furnish the Proper Checks and Balances',
      authors: ['Hamilton', 'Madison'],
      fullText: 'Text.',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed51.asp',
    };
    mockFetchResolved({ ok: true, status: 200, body: paper });

    render(await Page({ params: paramsFor('51') }));

    expect(screen.getByText('Hamilton, Madison')).toBeTruthy();
  });

  it("renders a quiet source tag linking to the paper's exact sourceUrl, with an accessible new-tab indication", async () => {
    const paper: PaperDetail = {
      paperNumber: 1,
      title: 'General Introduction',
      authors: ['Hamilton'],
      fullText: 'Text.',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
    };
    mockFetchResolved({ ok: true, status: 200, body: paper });

    render(await Page({ params: paramsFor('1') }));

    const link = screen.getByRole('link', { name: /Source: Avalon Project/ });
    expect(link.getAttribute('href')).toBe(
      'https://avalon.law.yale.edu/18th_century/fed01.asp',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    // Visually-hidden text so screen-reader users know it opens a new tab, not just sighted users
    // inferring it from the "↗" glyph.
    expect(link.textContent).toContain('opens in a new tab');
  });

  it('fetches the detail endpoint for the requested paper number from the configured API base URL', async () => {
    process.env.API_BASE_URL = 'https://example.test/api';
    mockFetchResolved({
      ok: true,
      status: 200,
      body: {
        paperNumber: 7,
        title: 'Title',
        authors: ['Hamilton'],
        fullText: 'Text.',
        sourceUrl: 'https://example.test/fed07.asp',
      },
    });

    await Page({ params: paramsFor('7') });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://example.test/api/papers/7',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it("renders a real 404 (Next's notFound signal) for a nonexistent paper number", async () => {
    mockFetchResolved({ ok: false, status: 404, body: {} });

    await expect(Page({ params: paramsFor('999') })).rejects.toMatchObject(
      NOT_FOUND_DIGEST,
    );
  });

  it("renders a real 404 (Next's notFound signal) for a non-numeric route segment, without fetching", async () => {
    global.fetch = jest.fn();

    await expect(Page({ params: paramsFor('abc') })).rejects.toMatchObject(
      NOT_FOUND_DIGEST,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // Number() + Number.isInteger() alone would silently accept all of these as a valid lookup --
  // they must go through parsePaperNumberRouteSegment's stricter check instead.
  it.each([
    ['0x10', 'hex notation'],
    ['1e2', 'exponential notation'],
    ['1.0', 'a decimal fraction that is numerically a whole number'],
    ['+1', 'a leading "+"'],
  ])(
    "renders a real 404 (Next's notFound signal) for %s (%s), without fetching",
    async (segment) => {
      global.fetch = jest.fn();

      await expect(Page({ params: paramsFor(segment) })).rejects.toMatchObject(
        NOT_FOUND_DIGEST,
      );
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it('renders a clear error state, without crashing, when the API cannot be reached', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    render(await Page({ params: paramsFor('1') }));

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders a clear error state when the API responds with a non-404 non-2xx status', async () => {
    mockFetchResolved({ ok: false, status: 500, body: {} });

    render(await Page({ params: paramsFor('1') }));

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders a clear error state, without crashing, when the API responds 2xx with an unparsable (non-JSON) body', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
    }) as unknown as typeof fetch;

    render(await Page({ params: paramsFor('1') }));

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders a clear error state when the API responds 2xx with an unexpected body shape', async () => {
    mockFetchResolved({ ok: true, status: 200, body: { unexpected: 'shape' } });

    render(await Page({ params: paramsFor('1') }));

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders a clear error state when authors contains a non-string element', async () => {
    mockFetchResolved({
      ok: true,
      status: 200,
      body: {
        paperNumber: 1,
        title: 'General Introduction',
        authors: [null],
        fullText: 'Text.',
        sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
      },
    });

    render(await Page({ params: paramsFor('1') }));

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders a clear error state when sourceUrl is an empty string', async () => {
    mockFetchResolved({
      ok: true,
      status: 200,
      body: {
        paperNumber: 1,
        title: 'General Introduction',
        authors: ['Hamilton'],
        fullText: 'Text.',
        sourceUrl: '',
      },
    });

    render(await Page({ params: paramsFor('1') }));

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders the generic "← Browse Papers" back-link to "/" when there is no search context', async () => {
    const paper: PaperDetail = {
      paperNumber: 1,
      title: 'General Introduction',
      authors: ['Hamilton'],
      fullText: 'Text.',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
    };
    mockFetchResolved({ ok: true, status: 200, body: paper });

    render(await Page({ params: paramsFor('1') }));

    const backLink = screen.getByRole('link', { name: '← Browse Papers' });
    expect(backLink.getAttribute('href')).toBe('/');
  });

  it("renders a context-aware \"← Back to results for '<term>'\" back-link when reached from a search", async () => {
    const paper: PaperDetail = {
      paperNumber: 51,
      title: 'The Structure of the Government Must Furnish the Proper Checks and Balances',
      authors: ['Hamilton', 'Madison'],
      fullText: 'Text.',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed51.asp',
    };
    mockFetchResolved({ ok: true, status: 200, body: paper });

    render(
      await Page({
        params: paramsFor('51'),
        searchParams: searchParamsFor('Madison'),
      }),
    );

    const backLink = screen.getByRole('link', { name: "← Back to results for 'Madison'" });
    expect(backLink.getAttribute('href')).toBe('/?q=Madison');
    expect(screen.queryByRole('link', { name: '← Browse Papers' })).toBeNull();
  });

  it('treats a whitespace-only q the same as an absent one (generic back-link)', async () => {
    const paper: PaperDetail = {
      paperNumber: 1,
      title: 'General Introduction',
      authors: ['Hamilton'],
      fullText: 'Text.',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
    };
    mockFetchResolved({ ok: true, status: 200, body: paper });

    render(
      await Page({ params: paramsFor('1'), searchParams: searchParamsFor('   ') }),
    );

    expect(screen.getByRole('link', { name: '← Browse Papers' })).toBeTruthy();
  });

  it('URL-encodes the search term in the back-link href', async () => {
    const paper: PaperDetail = {
      paperNumber: 1,
      title: 'General Introduction',
      authors: ['Hamilton'],
      fullText: 'Text.',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
    };
    mockFetchResolved({ ok: true, status: 200, body: paper });

    render(
      await Page({
        params: paramsFor('1'),
        searchParams: searchParamsFor('checks & balances'),
      }),
    );

    const backLink = screen.getByRole('link', {
      name: "← Back to results for 'checks & balances'",
    });
    expect(backLink.getAttribute('href')).toBe('/?q=checks%20%26%20balances');
  });

  it('renders a clear error state when paperNumber is NaN', async () => {
    mockFetchResolved({
      ok: true,
      status: 200,
      body: {
        paperNumber: Number.NaN,
        title: 'General Introduction',
        authors: ['Hamilton'],
        fullText: 'Text.',
        sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
      },
    });

    render(await Page({ params: paramsFor('1') }));

    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
