import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PapersController } from './papers.controller';
import { PapersService } from './papers.service';

/**
 * Real-HTTP test for the Browse Papers endpoint's wiring: PapersController + PapersService are
 * the real classes (only their DataSource dependency is faked), assembled the same way
 * PapersModule does, with the same global `api` prefix main.ts applies -- proving the route
 * decorator, DI wiring, and global prefix actually connect through Nest's real HTTP layer (an
 * actual TCP request via `fetch`, not a direct function call), rather than re-testing the
 * `libs/database` read path already covered by paper-browse.repository.integration.spec.ts.
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

  beforeAll(async () => {
    const fakeDataSource = {
      getRepository: jest.fn().mockReturnValue({
        find: jest.fn().mockResolvedValue([fakePaperRow]),
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
});
