/**
 * Strictly validates that a route segment (a NestJS `:paperNumber` param in `apps/api`, or a
 * Next.js dynamic `[paperNumber]` param in `apps/web`) looks like a plain decimal integer before
 * treating it as a paper number, returning `null` otherwise. Both apps need the identical rule --
 * a non-numeric route segment is handled exactly like "paper not found" -- so it lives here once
 * rather than being hand-duplicated as a regex in two places.
 *
 * `Number()` followed by `Number.isInteger()` is NOT sufficient on its own: `Number()` accepts
 * the full JS numeric-literal grammar, not just plain decimal digits, so `Number("0x10")` (16),
 * `Number("1e2")` (100), and `Number("1.0")` (1) would all silently pass `Number.isInteger()` and
 * be treated as valid paper lookups instead of 404ing. The regex below is checked first so only
 * an optional leading `-` followed by one or more digits (never hex, exponential notation, a
 * decimal fraction, or a leading `+`) is ever handed to `Number()`.
 */
export function parsePaperNumberRouteSegment(segment: string): number | null {
  if (!/^-?\d+$/.test(segment)) {
    return null;
  }
  return Number(segment);
}
