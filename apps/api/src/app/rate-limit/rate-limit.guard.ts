import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Ratelimit } from '@upstash/ratelimit';
import {
  DAILY_RATE_LIMITER,
  GLOBAL_RATE_LIMIT_KEY,
  PER_IP_RATE_LIMITER,
} from './rate-limit.provider';

/**
 * Bounds `POST /api/ask`'s cost exposure against the paid/metered AI provider it calls
 * (spec-4-2-rate-limiting-upstash.md). A no-op -- no Redis call at all -- whenever Upstash is
 * unconfigured (`PER_IP_RATE_LIMITER`/`DAILY_RATE_LIMITER` both `undefined`), which is the default
 * local-dev state and must remain zero-setup (this story's Boundaries & Constraints).
 *
 * Order matters: the per-IP check runs *before* the daily check, and both are independent boolean
 * gates. A request rejected by the per-IP throttle must never consume the daily cap's budget --
 * it never reached (and never will reach) `AskService.ask`/Gemini, so counting it against the
 * daily ceiling would double-penalize other callers for one IP's throttled burst (Design Notes).
 *
 * Fails closed: if Upstash *is* configured and a `.limit()` call itself throws/rejects (network
 * blip), the request is denied (500), not silently allowed through -- an Upstash outage must never
 * quietly turn into unlimited requests (this story's Boundaries & Constraints, I/O matrix).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    @Inject(PER_IP_RATE_LIMITER) private readonly perIpLimiter: Ratelimit | undefined,
    @Inject(DAILY_RATE_LIMITER) private readonly dailyLimiter: Ratelimit | undefined,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Upstash unconfigured (the default local-dev state) -- both limiters are always undefined
    // together (rate-limit.provider.ts derives both from the same Redis client). Only that
    // "both undefined" state is the real no-op; "exactly one defined" can't happen with today's
    // provider wiring, but if it ever did it would be a misconfiguration, not an inert state --
    // fail closed (500) rather than silently allowing every request through unlimited.
    if (!this.perIpLimiter && !this.dailyLimiter) {
      return true;
    }
    if (!this.perIpLimiter || !this.dailyLimiter) {
      this.logger.error(
        'Rate limit misconfiguration: exactly one of perIpLimiter/dailyLimiter is defined -- failing closed',
      );
      throw new InternalServerErrorException('rate limit misconfigured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    // `request.ip` resolves correctly behind Vercel's proxy in production and the local socket
    // address in dev via the same code path -- Express's `trust proxy` setting (enabled in
    // `main.ts`'s `createApp()`), never an `isProd` branch here (AD-5).
    const ip = request.ip ?? 'unknown';

    let perIpResult: { success: boolean };
    try {
      perIpResult = await this.perIpLimiter.limit(ip);
    } catch (err) {
      this.logger.error(`Per-IP rate limit check failed for ip=${ip}`, err as Error);
      throw new InternalServerErrorException('rate limit check failed');
    }
    if (!perIpResult.success) {
      throw new HttpException('too many requests, please try again later', HttpStatus.TOO_MANY_REQUESTS);
    }

    let dailyResult: { success: boolean };
    try {
      dailyResult = await this.dailyLimiter.limit(GLOBAL_RATE_LIMIT_KEY);
    } catch (err) {
      this.logger.error('Global daily rate limit check failed', err as Error);
      throw new InternalServerErrorException('rate limit check failed');
    }
    if (!dailyResult.success) {
      throw new HttpException(
        'daily limit reached, try again tomorrow',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
