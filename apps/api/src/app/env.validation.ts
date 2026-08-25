import { z } from 'zod';

/**
 * All environment-dependent configuration is read from process.env at
 * runtime (AD-5) — never hardcoded, never branched on `if isProd`.
 */
export const envSchema = z.object({
  DATABASE_URL: z
    .string({ message: 'DATABASE_URL is required' })
    .min(1, 'DATABASE_URL is required')
    .refine(isPostgresConnectionString, {
      message:
        'DATABASE_URL must be a valid postgres connection string (postgres:// or postgresql://)',
    }),
});

export type Env = z.infer<typeof envSchema>;

function isPostgresConnectionString(value: string): boolean {
  try {
    const url = new URL(value);
    const hasPostgresProtocol =
      url.protocol === 'postgres:' || url.protocol === 'postgresql:';
    return hasPostgresProtocol && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/**
 * Validates process.env and fails fast with a clear error rather than
 * letting the app boot silently against a missing/invalid DATABASE_URL.
 */
export function validateEnv(env: Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
