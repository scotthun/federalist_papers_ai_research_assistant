import { ExecutionContext, HttpException, InternalServerErrorException, Logger } from '@nestjs/common';
import type { Ratelimit } from '@upstash/ratelimit';
import { RateLimitGuard } from './rate-limit.guard';
import { createRateLimitRedisClient, parseRateLimitIntEnv } from './rate-limit.provider';

/** Builds a minimal fake `ExecutionContext` wrapping a fake Express request -- just enough shape
 *  for `RateLimitGuard.canActivate` to read `request.ip`. */
function fakeContext(ip: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
    }),
  } as unknown as ExecutionContext;
}

function fakeLimiter(limit: jest.Mock): Ratelimit {
  return { limit } as unknown as Ratelimit;
}

describe('RateLimitGuard', () => {
  // spec-4-2-rate-limiting-upstash.md I/O matrix: "Local dev, Upstash unset ... Request proceeds
  // normally, no Redis call."
  it('is a no-op (allows the request, calls neither limiter) when both limiters are undefined', async () => {
    const guard = new RateLimitGuard(undefined, undefined);

    await expect(guard.canActivate(fakeContext('1.2.3.4'))).resolves.toBe(true);
  });

  // I/O matrix: "Under both limits ... Request proceeds to AskService.ask()."
  it('allows the request when both the per-IP and daily limiter report success', async () => {
    const perIp = jest.fn().mockResolvedValue({ success: true });
    const daily = jest.fn().mockResolvedValue({ success: true });
    const guard = new RateLimitGuard(fakeLimiter(perIp), fakeLimiter(daily));

    await expect(guard.canActivate(fakeContext('1.2.3.4'))).resolves.toBe(true);
    expect(perIp).toHaveBeenCalledWith('1.2.3.4');
    expect(daily).toHaveBeenCalledWith('global');
  });

  // I/O matrix: "Per-IP limit exceeded ... 429 ... daily counter NOT incremented." Also this
  // story's Boundaries: per-IP runs before daily, and a per-IP rejection must never touch the
  // daily budget.
  it('throws a 429 and never calls the daily limiter when the per-IP limiter reports failure', async () => {
    const perIp = jest.fn().mockResolvedValue({ success: false });
    const daily = jest.fn().mockResolvedValue({ success: true });
    const guard = new RateLimitGuard(fakeLimiter(perIp), fakeLimiter(daily));

    await expect(guard.canActivate(fakeContext('1.2.3.4'))).rejects.toBeInstanceOf(HttpException);
    expect(daily).not.toHaveBeenCalled();
  });

  it('reports a 429 status for the per-IP rejection', async () => {
    const perIp = jest.fn().mockResolvedValue({ success: false });
    const daily = jest.fn();
    const guard = new RateLimitGuard(fakeLimiter(perIp), fakeLimiter(daily));

    await expect(guard.canActivate(fakeContext('1.2.3.4'))).rejects.toMatchObject({
      status: 429,
    });
  });

  // I/O matrix: "Daily cap exceeded ... 429, exact message 'daily limit reached, try again
  // tomorrow'."
  it('throws a 429 with the exact daily-limit message when the daily limiter reports failure', async () => {
    const perIp = jest.fn().mockResolvedValue({ success: true });
    const daily = jest.fn().mockResolvedValue({ success: false });
    const guard = new RateLimitGuard(fakeLimiter(perIp), fakeLimiter(daily));

    await expect(guard.canActivate(fakeContext('1.2.3.4'))).rejects.toMatchObject({
      status: 429,
      message: 'daily limit reached, try again tomorrow',
    });
  });

  // I/O matrix: "Upstash configured but unreachable ... Request denied (fail closed) ... Guard
  // catches the error and throws a 5xx, logged."
  it('fails closed (throws, does not allow the request) when the per-IP limiter call itself rejects', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const perIp = jest.fn().mockRejectedValue(new Error('network blip'));
    const daily = jest.fn();
    const guard = new RateLimitGuard(fakeLimiter(perIp), fakeLimiter(daily));

    await expect(guard.canActivate(fakeContext('1.2.3.4'))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(daily).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Per-IP rate limit check failed'),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  it('fails closed when the daily limiter call itself rejects', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const perIp = jest.fn().mockResolvedValue({ success: true });
    const daily = jest.fn().mockRejectedValue(new Error('network blip'));
    const guard = new RateLimitGuard(fakeLimiter(perIp), fakeLimiter(daily));

    await expect(guard.canActivate(fakeContext('1.2.3.4'))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Global daily rate limit check failed'),
      expect.any(Error),
    );
    errorSpy.mockRestore();
  });

  // Finding #3: "exactly one limiter defined" is a misconfiguration this provider wiring can't
  // produce today (both derive from the same Redis client), but if it ever did, it must fail
  // closed (500), not silently allow the request the way "both undefined" (Upstash unset) does.
  it('fails closed with a 500 when exactly one limiter is defined (mismatched state)', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const perIp = jest.fn();
    const guardOnlyPerIp = new RateLimitGuard(fakeLimiter(perIp), undefined);

    await expect(guardOnlyPerIp.canActivate(fakeContext('1.2.3.4'))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(perIp).not.toHaveBeenCalled();

    const daily = jest.fn();
    const guardOnlyDaily = new RateLimitGuard(undefined, fakeLimiter(daily));

    await expect(guardOnlyDaily.canActivate(fakeContext('1.2.3.4'))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(daily).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('falls back to "unknown" as the identifier when request.ip is absent, without throwing', async () => {
    const perIp = jest.fn().mockResolvedValue({ success: true });
    const daily = jest.fn().mockResolvedValue({ success: true });
    const guard = new RateLimitGuard(fakeLimiter(perIp), fakeLimiter(daily));
    const contextWithNoIp = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(contextWithNoIp)).resolves.toBe(true);
    expect(perIp).toHaveBeenCalledWith('unknown');
  });
});

describe('parseRateLimitIntEnv', () => {
  it('returns the default when the env var is unset', () => {
    expect(parseRateLimitIntEnv({}, 'ASK_DAILY_LIMIT', 250)).toBe(250);
  });

  it('returns the parsed integer when the env var is a valid positive integer', () => {
    expect(parseRateLimitIntEnv({ ASK_DAILY_LIMIT: '500' }, 'ASK_DAILY_LIMIT', 250)).toBe(500);
  });

  // Boundaries & Constraints: "a malformed value falls back to the default, never a crash."
  // Finding #6: also warns the operator, naming the env var key and the raw malformed value,
  // rather than silently ignoring what they configured.
  it.each([['not-a-number'], ['0'], ['-5'], ['1.5'], ['']])(
    'falls back to the default for malformed value %s rather than throwing, and logs a warning',
    (raw) => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      expect(parseRateLimitIntEnv({ ASK_DAILY_LIMIT: raw }, 'ASK_DAILY_LIMIT', 250)).toBe(250);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ASK_DAILY_LIMIT'),
      );
      warnSpy.mockRestore();
    },
  );

  it('does not warn when the env var is unset or a valid positive integer', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    parseRateLimitIntEnv({}, 'ASK_DAILY_LIMIT', 250);
    parseRateLimitIntEnv({ ASK_DAILY_LIMIT: '500' }, 'ASK_DAILY_LIMIT', 250);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('createRateLimitRedisClient', () => {
  it('returns undefined without warning when both env vars are unset', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    expect(createRateLimitRedisClient({})).toBeUndefined();

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns a client without warning when both env vars are set', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const client = createRateLimitRedisClient({
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
    });

    expect(client).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // Finding #4: exactly one of the two set is a likely misconfiguration -- it must not be
  // silently treated the same as "both unset" with zero signal to the operator.
  it('returns undefined but warns when only the URL is set', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const client = createRateLimitRedisClient({
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    });

    expect(client).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('UPSTASH_REDIS_REST_URL'),
    );
    warnSpy.mockRestore();
  });

  it('returns undefined but warns when only the token is set', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const client = createRateLimitRedisClient({
      UPSTASH_REDIS_REST_TOKEN: 'token',
    });

    expect(client).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('UPSTASH_REDIS_REST_TOKEN'),
    );
    warnSpy.mockRestore();
  });
});
