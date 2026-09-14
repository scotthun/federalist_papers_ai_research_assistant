import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Real-HTTP test for `createApp()`'s `app.set('trust proxy', 1)` call (main.ts) -- the pure-unit
 * tests in `main.spec.ts` (`parsePort`, `resolveCorsOrigin`) can't exercise this, since whether
 * `request.ip` actually resolves correctly behind a proxy is an Express/Node HTTP-layer behavior,
 * not something a fake `ExecutionContext` can prove.
 *
 * Deliberately does NOT call `createApp()`/build the real `AppModule` -- `AppModule` wires
 * `TypeOrmModule.forRootAsync`, which would make this test require a live, reachable Postgres to
 * even boot, unlike every other test in this suite (e.g. `ask.http.spec.ts` builds a mocked
 * `TestingModule`, never the real app). Confirmed live: this test only passed against the real
 * `AppModule` because a Postgres container happened to still be running from earlier manual
 * testing in this session -- it would fail on a clean checkout or CI. Instead, this builds a
 * trivial DB-free module and applies the identical single `app.set('trust proxy', 1)` line
 * `createApp()` itself uses, which is enough to verify the actual thing worth verifying --
 * Express's `trust proxy` resolution semantics -- without the unrelated DB dependency.
 *
 * `trust proxy: 1` means "trust exactly one hop": the directly-connecting socket (always
 * `127.0.0.1` here, an in-process loopback request) is trusted as that one hop, so
 * `request.ip` resolves to the right-most entry of `X-Forwarded-For` -- the address that hop
 * itself reported as the client, per Express's `proxy-addr` semantics (spec-4-2-rate-limiting-
 * upstash.md, AD-5: "Express trusts the immediate proxy hop's `X-Forwarded-For` header").
 */
@Module({})
class TrustProxyTestModule {}

describe('trust proxy wiring (HTTP)', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(TrustProxyTestModule);
    // Same single line createApp() (main.ts) applies -- this test exists specifically to verify
    // its effect without pulling in the real AppModule's Postgres dependency.
    app.set('trust proxy', 1);
    app.getHttpAdapter().get(
      '/api/__test-ip',
      (req: { ip: string }, res: { json: (body: unknown) => void }) => {
        res.json({ ip: req.ip });
      },
    );
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? address : address?.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves request.ip to the right-most X-Forwarded-For entry (trusting exactly the one loopback hop)', async () => {
    const response = await fetch(`${baseUrl}/api/__test-ip`, {
      headers: { 'X-Forwarded-For': '203.0.113.5, 70.41.3.18, 150.172.238.178' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ip: '150.172.238.178' });
  });

  it('resolves request.ip to the single client address when X-Forwarded-For has only one hop', async () => {
    const response = await fetch(`${baseUrl}/api/__test-ip`, {
      headers: { 'X-Forwarded-For': '198.51.100.23' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ip: '198.51.100.23' });
  });

  it('falls back to the direct socket address (loopback) when no X-Forwarded-For header is sent', async () => {
    const response = await fetch(`${baseUrl}/api/__test-ip`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ip: string };
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(body.ip);
  });
});
