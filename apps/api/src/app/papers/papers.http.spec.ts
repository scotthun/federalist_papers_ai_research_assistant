import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

/**
 * Real-HTTP test for the Browse Papers and Paper Reader endpoints' wiring: PapersController +
 * PapersService are the real classes (only their DataSource dependency is faked), assembled the
 * same way PapersModule does, with the same global `api` prefix main.ts applies -- proving the
 * route decorators, DI wiring, and global prefix actually connect through Nest's real HTTP layer
 * (an actual TCP request via `fetch`, not a direct function call), rather than re-testing the
 * `libs/database` read paths already covered by paper-browse.repository.integration.spec.ts and
 * paper-detail.repository.integration.spec.ts.
 *
 * No supertest dependency: `app.listen(0)` (an ephemeral port) plus the platform's own global
 * `fetch` is enough for a genuine end-to-end HTTP round trip in-process.
 */
describe('GET /api/papers (HTTP wiring)', () => {
  let app: INestApplication;
  let baseUrl: string;

  const fakePaperRow = {
    paperNumber: 1,
    title: 'General Introduction',
    authors: [{ name: 'Hamilton' }],
  };

  const fakePaperDetailRow = {
    paperNumber: 1,
    title: 'General Introduction',
    fullText: 'Paragraph one.\n\nParagraph two.',
    sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
    authors: [{ name: 'Hamilton' }],
  };

  // Chainable fake for the keyword-search path's `createQueryBuilder(...).getRawMany()` call
  // (paper-search.repository.ts's `findByKeyword`) -- resolves to one matching id, which then
  // flows into the same `find` mock below (mirroring `findByKeyword`'s real second, hydrating
  // query), so a keyword search resolves end to end through Nest's real HTTP routing layer
  // instead of only being reachable via the plain-integer branch.
  function fakeQueryBuilder() {
    return {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      distinct: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ id: 'fake-id' }]),
    };
  }

  beforeAll(async () => {
    const fakeDataSource = {
      getRepository: jest.fn().mockReturnValue({
        find: jest.fn().mockResolvedValue([fakePaperRow]),
        findOne: jest.fn().mockImplementation(({ where: { paperNumber } }) =>
          Promise.resolve(paperNumber === 1 ? fakePaperDetailRow : null),
        ),
        createQueryBuilder: jest.fn().mockImplementation(() => fakeQueryBuilder()),
      }),
    } as unknown as DataSource;

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [PapersController],
      providers: [
        PapersService,
        { provide: getDataSourceToken(), useValue: fakeDataSource },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api'); // mirrors main.ts's app.setGlobalPrefix('api')
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? address : address?.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('is reachable at the global-prefixed route and returns PaperSummary[]', async () => {
    const response = await fetch(`${baseUrl}/api/papers`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { paperNumber: 1, title: 'General Introduction', authors: ['Hamilton'] },
    ]);
  });

  it('is not reachable without the global prefix', async () => {
    const response = await fetch(`${baseUrl}/papers`);

    expect(response.status).toBe(404);
  });

  it('GET /api/papers/search is reachable at the global-prefixed route and returns PaperSummary[]', async () => {
    const response = await fetch(`${baseUrl}/api/papers/search?q=1`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { paperNumber: 1, title: 'General Introduction', authors: ['Hamilton'] },
    ]);
  });

  // Proves the route registration order: PapersController declares `search` before
  // `:paperNumber`, so `/papers/search` resolves to the search handler (200, an array) rather
  // than being swallowed by `:paperNumber` (which would 404, since "search" isn't numeric). A
  // real HTTP round trip through the actual route is what actually proves this -- a controller
  // unit test calling `controller.search(...)` directly can't, since it never goes through Nest's
  // route matching at all.
  it('GET /api/papers/search is not shadowed by the :paperNumber route', async () => {
    const response = await fetch(`${baseUrl}/api/papers/search`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  // A keyword (non-numeric) search term only exercises `findByKeyword`'s `createQueryBuilder`
  // path, never `find`'s plain-integer path -- until this fake gained a `createQueryBuilder`
  // mock, the two existing `/api/papers/search` tests above only proved the plain-integer branch
  // wired up correctly. This is the first real-HTTP-round-trip proof that a keyword search
  // resolves end to end through Nest's actual routing layer.
  it('GET /api/papers/search resolves a keyword query through the ILIKE query-builder path', async () => {
    const response = await fetch(`${baseUrl}/api/papers/search?q=Hamilton`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { paperNumber: 1, title: 'General Introduction', authors: ['Hamilton'] },
    ]);
  });

  // A repeated `?q=a&q=b` resolves to `string[]` under Nest/Express -- before the controller
  // normalized this to its first value, `q ?? ''` let the array through unchanged, which reached
  // `searchPapers`'s `query.trim()` and threw (`TypeError: query.trim is not a function`),
  // producing an unhandled 500. A real HTTP round trip is what actually proves the fix, since a
  // direct call to `controller.search(...)` wouldn't go through Nest/Express's own query-param
  // parsing that produces the array in the first place.
  it('GET /api/papers/search handles a repeated q param without a 500, using only the first value', async () => {
    const response = await fetch(`${baseUrl}/api/papers/search?q=a&q=b`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/papers/:paperNumber is reachable at the global-prefixed route and returns PaperDetail', async () => {
    const response = await fetch(`${baseUrl}/api/papers/1`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      paperNumber: 1,
      title: 'General Introduction',
      authors: ['Hamilton'],
      fullText: 'Paragraph one.\n\nParagraph two.',
      sourceUrl: 'https://avalon.law.yale.edu/18th_century/fed01.asp',
    });
  });

  it('GET /api/papers/:paperNumber returns 404 for a nonexistent paper number', async () => {
    const response = await fetch(`${baseUrl}/api/papers/999`);

    expect(response.status).toBe(404);
  });

  it('GET /api/papers/:paperNumber returns 404 for a non-numeric route segment', async () => {
    const response = await fetch(`${baseUrl}/api/papers/abc`);

    expect(response.status).toBe(404);
  });

  // Number() + Number.isInteger() alone would silently accept all of these as paper "1" -- a
  // real HTTP round trip through the actual route confirms the stricter check is really wired
  // up end to end, not just unit-tested against the controller method directly.
  it.each(['0x10', '1e2', '1.0', '+1'])(
    'GET /api/papers/:paperNumber returns 404 for the Number()-lenient lookalike %s',
    async (segment) => {
      const response = await fetch(`${baseUrl}/api/papers/${segment}`);

      expect(response.status).toBe(404);
    },
  );
});
