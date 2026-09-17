'use client';

import { useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Self-contained "Quick find" search box (Story 2.1) -- its own input state via `useState`, no
 * props, no global store (Boundaries: "its own input state (useState), no props required, no
 * global store"; Design Notes: "QuickFindSearch takes no props today"). Search state lives in the
 * URL, never in this component's memory or a client-side store -- submitting is a plain HTML
 * form GET to `/`, which is what actually performs the `/?q=<term>` navigation (Next.js's own
 * URL-based routing, not a client router call): the browser builds the query string from the
 * input's `name="q"` and current value with zero extra JS, and the Browse Papers Server Component
 * re-fetches from its `searchParams.q` on the resulting request. This also means the story's
 * "empty query" boundary (submitting blank must behave like `q` being absent, never "search for
 * nothing") needs no special-casing here -- submitting empty just navigates to `/?q=`, and
 * `apps/web/src/app/page.tsx` already treats a blank `q` exactly like an absent one.
 */
export function QuickFindSearch() {
  const [term, setTerm] = useState('');

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setTerm(event.target.value);
  }

  return (
    <form role="search" action="/" method="get" className="flex gap-2">
      <label htmlFor="quick-find-input" className="sr-only">
        Search by number, author, title, or keyword
      </label>
      <input
        id="quick-find-input"
        type="search"
        name="q"
        value={term}
        onChange={handleChange}
        placeholder="Search by number, author, title, or keyword"
        // text-base (16px) below md, text-sm (14px) at md+ -- iOS Safari auto-zooms the whole
        // page on focusing any input under 16px, forcing a manual pinch-zoom-out afterward
        // (confirmed live on a 390px mobile viewport). 16px on mobile avoids that; the desktop
        // size is preserved unchanged.
        className="h-9 w-full rounded-md border border-border bg-background px-3 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm"
      />
      <Button type="submit">Search</Button>
    </form>
  );
}
