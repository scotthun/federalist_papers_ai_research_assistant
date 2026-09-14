import { Logger, type Provider } from '@nestjs/common';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';

const logger = new Logger('RateLimitProvider');

/** DI token for the shared Upstash `Redis` client -- `undefined` whenever either
 *  `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` is unset (spec-4-2's "fully inert ... local
 *  dev" requirement). Deliberately not validated via `env.validation.ts`'s Zod schema -- these
 *  vars are optional, read directly from `process.env` here, same "blank means unset" convention
 *  `resolveCorsOrigin` (main.ts) already uses for `WEB_ORIGIN`. */
export const RATE_LIMIT_REDIS_CLIENT = 'RATE_LIMIT_REDIS_CLIENT';

/** DI token for the per-IP-per-minute `Ratelimit` instance (sliding window, keyed by caller IP at
 *  call time) -- `undefined` under the same "Upstash unset" condition as `RATE_LIMIT_REDIS_CLIENT`
 *  above. */
export const PER_IP_RATE_LIMITER = 'PER_IP_RATE_LIMITER';

/** DI token for the global-daily `Ratelimit` instance (sliding window, always called with the
 *  constant identifier `"global"` -- there is no per-caller key for this one, by design: it's a
 *  single ceiling shared across every caller). `undefined` under the same "Upstash unset"
 *  condition. */
export const DAILY_RATE_LIMITER = 'DAILY_RATE_LIMITER';

/** Identifier every call to the daily `Ratelimit` instance is keyed on -- a single shared budget,
 *  not per-caller (spec-4-2: "a global daily cap"). */
export const GLOBAL_RATE_LIMIT_KEY = 'global';

export const DEFAULT_ASK_RATE_LIMIT_PER_MINUTE = 10;
export const DEFAULT_ASK_DAILY_LIMIT = 250;

/**
 * Defensive numeric-env-var parse mirroring this codebase's other operator-configurable numeric
 * env vars (`PORT`, `INGEST_*`) in shape -- read `process.env`, `Number(...)`, validate. Diverges
 * from those in outcome on purpose (spec-4-2's Boundaries & Constraints): a malformed value here
 * falls back to the default rather than throwing, since a bad rate-limit value must never crash
 * the whole app the way a bad `PORT`/`INGEST_*` value is allowed to -- these two vars are optional
 * cost-exposure knobs, not boot-required config.
 */
export function parseRateLimitIntEnv(
  env: Record<string, string | undefined>,
  key: string,
  defaultValue: number,
): number {
  const raw = env[key];
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    logger.warn(
      `${key} is set to a malformed value "${raw}" (must be a positive integer) -- falling back to the default (${defaultValue})`,
    );
    return defaultValue;
  }
  return value;
}

/**
 * Builds the shared Upstash `Redis` client from `UPSTASH_REDIS_REST_URL`/
 * `UPSTASH_REDIS_REST_TOKEN` -- `undefined` when either is unset/blank, the "fully inert" default
 * local-dev state this story requires (spec-4-2's Boundaries & Constraints). Mirrors
 * `ai-provider.provider.ts`'s "one factory-provider per external dependency" shape.
 */
export function createRateLimitRedisClient(
  env: Record<string, string | undefined> = process.env,
): Redis | undefined {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    if (url || token) {
      logger.warn(
        `Only one of UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN is set -- treating Upstash as unconfigured (rate limiting disabled). Set both or neither.`,
      );
    }
    return undefined;
  }
  return new Redis({ url, token });
}

/** Nest factory provider for `RATE_LIMIT_REDIS_CLIENT` -- see `createRateLimitRedisClient` above. */
export function createRateLimitRedisClientProvider(): Provider {
  return {
    provide: RATE_LIMIT_REDIS_CLIENT,
    useFactory: (): Redis | undefined => createRateLimitRedisClient(),
  };
}

/**
 * Nest factory provider for `PER_IP_RATE_LIMITER` -- a sliding-window `Ratelimit` over the shared
 * Redis client, `"1 m"` window sized by `ASK_RATE_LIMIT_PER_MINUTE` (default
 * `DEFAULT_ASK_RATE_LIMIT_PER_MINUTE`). `undefined` whenever the Redis client itself is
 * `undefined` (Upstash unset) -- `RateLimitGuard` treats that as a no-op, never calling Upstash.
 */
export function createPerIpRateLimiterProvider(): Provider {
  return {
    provide: PER_IP_RATE_LIMITER,
    inject: [RATE_LIMIT_REDIS_CLIENT],
    useFactory: (redis: Redis | undefined): Ratelimit | undefined => {
      if (!redis) return undefined;
      const limit = parseRateLimitIntEnv(
        process.env,
        'ASK_RATE_LIMIT_PER_MINUTE',
        DEFAULT_ASK_RATE_LIMIT_PER_MINUTE,
      );
      return new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, '1 m'),
        prefix: 'federalist-research:ask:per-ip',
      });
    },
  };
}

/**
 * Nest factory provider for `DAILY_RATE_LIMITER` -- a sliding-window `Ratelimit` over the shared
 * Redis client, `"1 d"` window sized by `ASK_DAILY_LIMIT` (default `DEFAULT_ASK_DAILY_LIMIT`),
 * always called with `GLOBAL_RATE_LIMIT_KEY`. `undefined` under the same "Upstash unset"
 * condition as `PER_IP_RATE_LIMITER`.
 */
export function createDailyRateLimiterProvider(): Provider {
  return {
    provide: DAILY_RATE_LIMITER,
    inject: [RATE_LIMIT_REDIS_CLIENT],
    useFactory: (redis: Redis | undefined): Ratelimit | undefined => {
      if (!redis) return undefined;
      const limit = parseRateLimitIntEnv(
        process.env,
        'ASK_DAILY_LIMIT',
        DEFAULT_ASK_DAILY_LIMIT,
      );
      return new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, '1 d'),
        prefix: 'federalist-research:ask:daily',
      });
    },
  };
}
