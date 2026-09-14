import { Module } from '@nestjs/common';
import {
  DAILY_RATE_LIMITER,
  PER_IP_RATE_LIMITER,
  RATE_LIMIT_REDIS_CLIENT,
  createDailyRateLimiterProvider,
  createPerIpRateLimiterProvider,
  createRateLimitRedisClientProvider,
} from './rate-limit.provider';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * Thin module exposing `RateLimitGuard` (and the Upstash client/`Ratelimit` providers it depends
 * on) for `AskModule` to import (spec-4-2-rate-limiting-upstash.md). Deliberately not imported by
 * `AppModule` -- this story scopes the guard to `AskController` only, never globally (`GET
 * /api/papers*` routes are not rate-limited by this story).
 *
 * Exports every provider, not just `RateLimitGuard` -- confirmed live (a real `npm run dev` boot,
 * not the mocked-DI unit/controller tests, which don't exercise real cross-module resolution):
 * `@UseGuards(RateLimitGuard)` on `AskController` resolves the guard's constructor args against
 * *`AskModule`'s* visible providers, not `RateLimitModule`'s internal ones, so
 * `PER_IP_RATE_LIMITER`/`DAILY_RATE_LIMITER` must be exported too or Nest throws
 * `UnknownDependenciesException` at boot.
 */
@Module({
  providers: [
    createRateLimitRedisClientProvider(),
    createPerIpRateLimiterProvider(),
    createDailyRateLimiterProvider(),
    RateLimitGuard,
  ],
  exports: [RateLimitGuard, RATE_LIMIT_REDIS_CLIENT, PER_IP_RATE_LIMITER, DAILY_RATE_LIMITER],
})
export class RateLimitModule {}
