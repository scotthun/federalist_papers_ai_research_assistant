/**
 * @jest-environment node
 *
 * Node's environment (not jsdom, this project's default for apps/web) is used deliberately here:
 * Next.js route handlers are built on the Web-standard `Request`/`Response`/`ReadableStream`
 * globals, which Node's runtime provides natively (this project pins Node 24) but jsdom's test
 * environment does not -- overriding just this one spec file avoids needing any polyfill.
 */
import { POST } from '../../src/app/api/ask/route';
import { readAllAskStreamEvents } from '../components/quill/ask-stream-test-helpers';

/**
 * `apps/web/src/app/api/ask/route.ts` proxies a client-side question to apps/api's real
 * `POST /api/ask` (Story 3.1), then relays a 2xx response back as NDJSON (Story 5.1). It's a
 * plain async function under the hood (Next.js route handler convention), so it can be invoked
 * directly with a real `Request`, same "call the function directly" approach the page specs
 * already use for Server Components. Only the `global.fetch` boundary (apps/api itself) is
 * faked -- never a real network call.
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

function mockApiAskResolved(init: { ok: boolean; status?: number; body: unknown }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    json: () => Promise.resolve(init.body),
  }) as unknown as typeof fetch;
}

describe('POST /api/ask (route handler)', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.API_BASE_URL = originalApiBaseUrl;
    jest.resetAllMocks();
  });

  it('streams a confident-tier answer as token events followed by one done event', async () => {
    mockApiAskResolved({
      ok: true,
      body: {
        answer: 'Ambition must counteract ambition.',
        citations: [
          {
            paperNumber: 51,
            paperTitle: 'The Structure of the Government Must Furnish the Proper Checks and Balances',
            chunkId: 'chunk-1',
            quotedPassage: 'Ambition must counteract ambition.',
          },
        ],
        confidence: 'high',
        insufficientEvidence: false,
      },
    });

    const response = await POST(requestWithBody({ question: 'Why checks and balances?' }));

    expect(response.status).toBe(200);
    const events = await readAllAskStreamEvents(response);

    const tokenEvents = events.filter((event) => event.type === 'token');
    const doneEvents = events.filter((event) => event.type === 'done');

    expect(tokenEvents.length).toBeGreaterThan(0);
    expect(doneEvents).toHaveLength(1);
    // Every token event arrives strictly before the one done event -- asserted positionally
    // (not just "the last event happens to be done"), so a bug that emitted a stray token after
    // done (e.g. a reordering in the word-delay loop) would actually be caught.
    const doneIndex = events.findIndex((event) => event.type === 'done');
    expect(doneIndex).toBe(events.length - 1);
    expect(events.slice(0, doneIndex).every((event) => event.type === 'token')).toBe(true);

    const reassembled = tokenEvents
      .map((event) => (event.type === 'token' ? event.text : ''))
      .join('');
    expect(reassembled).toBe('Ambition must counteract ambition.');

    const doneEvent = doneEvents[0];
    if (doneEvent.type !== 'done') throw new Error('expected a done event');
    expect(doneEvent.answer).toBe('Ambition must counteract ambition.');
    expect(doneEvent.confidence).toBe('high');
    expect(doneEvent.citations).toHaveLength(1);
  });

  it('sends only a single done event (no token events) for a clarify/refuse-tier answer', async () => {
    mockApiAskResolved({
      ok: true,
      body: {
        answer:
          "I couldn't find sufficient evidence in the Federalist Papers to answer that confidently.",
        citations: [],
        confidence: 'low',
        insufficientEvidence: true,
      },
    });

    const response = await POST(requestWithBody({ question: 'What is the best pizza topping?' }));

    expect(response.status).toBe(200);
    const events = await readAllAskStreamEvents(response);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('done');
    if (events[0].type !== 'done') throw new Error('expected a done event');
    expect(events[0].confidence).toBe('low');
    expect(events[0].insufficientEvidence).toBe(true);
  });

  it("forwards apps/api's 400 (blank question) response unchanged, without streaming", async () => {
    const errorBody = { message: 'question is required and must not be blank' };
    mockApiAskResolved({ ok: false, status: 400, body: errorBody });

    const response = await POST(requestWithBody({ question: '   ' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(errorBody);
  });

  it("sends the request body through to apps/api's POST /ask, using the configured API_BASE_URL", async () => {
    process.env.API_BASE_URL = 'https://example.test/api';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          answer: 'Because ambition must be made to counteract ambition.',
          citations: [],
          confidence: 'low',
          insufficientEvidence: true,
        }),
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

  it('returns 502 (not a stream around invalid data) when apps/api returns a 2xx body that fails Answer validation', async () => {
    mockApiAskResolved({ ok: true, body: { unexpected: 'shape' } });

    const response = await POST(requestWithBody({ question: 'Why checks and balances?' }));

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(typeof body.message).toBe('string');
  });
});
