/**
 * @jest-environment node
 *
 * Node's environment (not jsdom, this project's default for apps/web) is used deliberately here:
 * Next.js route handlers are built on the Web-standard `Request`/`Response` globals, which
 * Node's runtime provides natively (this project pins Node 24) but jsdom's test environment does
 * not -- overriding just this one spec file avoids needing any Request/Response polyfill.
 */
import { POST } from '../../src/app/api/ask/route';

/**
 * `apps/web/src/app/api/ask/route.ts` proxies a client-side question to apps/api's real
 * `POST /api/ask` (Story 3.1) -- it's a plain async function under the hood (Next.js route
 * handler convention), so it can be invoked directly with a real `Request`, same "call the
 * function directly" approach the page specs already use for Server Components. Only the
 * `global.fetch` boundary (apps/api itself) is faked -- never a real network call.
 */
const originalFetch = global.fetch;
const originalApiBaseUrl = process.env.API_BASE_URL;

function requestWithBody(body: unknown): Request {
  return new Request('http://localhost/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ask (route handler)', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.API_BASE_URL = originalApiBaseUrl;
    jest.resetAllMocks();
  });

  it('forwards a successful apps/api response (status and body) unchanged', async () => {
    const answerBody = {
      answer: 'Because ambition must be made to counteract ambition.',
      citations: [],
      confidence: 'high',
      insufficientEvidence: false,
    };
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(answerBody),
    }) as unknown as typeof fetch;

    const response = await POST(requestWithBody({ question: 'Why checks and balances?' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(answerBody);
  });

  it('forwards apps/api\'s 400 (blank question) response unchanged', async () => {
    const errorBody = { message: 'question is required and must not be blank' };
    global.fetch = jest.fn().mockResolvedValue({
      status: 400,
      json: () => Promise.resolve(errorBody),
    }) as unknown as typeof fetch;

    const response = await POST(requestWithBody({ question: '   ' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(errorBody);
  });

  it('sends the request body through to apps/api\'s POST /ask, using the configured API_BASE_URL', async () => {
    process.env.API_BASE_URL = 'https://example.test/api';
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({}),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(requestWithBody({ question: 'Why checks and balances?' }));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/api/ask',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ question: 'Why checks and balances?' }),
      }),
    );
  });

  it('returns 400 without calling apps/api when the request body is not valid JSON', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const malformedRequest = new Request('http://localhost/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    const response = await POST(malformedRequest);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 502 (not a hang or an uncaught crash) when apps/api is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused')) as unknown as typeof fetch;

    const response = await POST(requestWithBody({ question: 'Why checks and balances?' }));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(typeof body.message).toBe('string');
  });
});
