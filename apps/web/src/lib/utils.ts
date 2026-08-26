import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Standard shadcn/ui helper: merges conditional class lists (clsx) and then resolves conflicting
 * Tailwind utility classes so the last one wins (tailwind-merge), e.g. `cn('px-2', 'px-4')` ->
 * `'px-4'`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
