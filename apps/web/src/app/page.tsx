import Link from 'next/link';
import type { PaperSummary } from '@federalist-research/shared';
import { ApiUnreachableNotice } from '@/components/api-unreachable-notice';
import { AskQuestion } from '@/components/ask-question';
import { QuickFindSearch } from '@/components/quick-find-search';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { API_FETCH_TIMEOUT_MS, resolveApiBaseUrl } from '@/lib/api-client';

async function fetchPaperList(path: string): Promise<PaperSummary[]> {
  const baseUrl = resolveApiBaseUrl();

  const response = await fetch(`${baseUrl}${path}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GET ${path} responded with status ${response.status}`);
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    // A malformed 2xx body must fail the same way an unreachable API does (I/O matrix, "API
    // unreachable") rather than throwing further downstream (e.g. inside .map()) once rendering
    // has already started.
    throw new Error(`GET ${path} responded with a non-array body`);
  }

  return body as PaperSummary[];
}

function fetchPapers(): Promise<PaperSummary[]> {
  return fetchPaperList('/papers');
}

function fetchSearchResults(query: string): Promise<PaperSummary[]> {
  return fetchPaperList(`/papers/search?q=${encodeURIComponent(query)}`);
}

/** Next.js App Router page-prop convention: `searchParams` is always a `Promise` (same as the
 * Paper Reader page's `params`). Defaulted so direct test invocations that omit it entirely
 * (this page's pre-Story-2.1 tests) keep working unchanged -- Next itself always supplies a real
 * value at request time, so the default never applies outside a test. */
export default async function BrowsePapersPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<{ q?: string | string[] }>;
} = {}) {
  const resolvedSearchParams = await searchParams;
  const rawQuery = resolvedSearchParams.q;
  // A repeated `?q=&q=` would arrive as string[] -- only the first value is ever meaningful here.
  const query = (Array.isArray(rawQuery) ? rawQuery[0] ?? '' : rawQuery ?? '').trim();
  // Empty/whitespace `q` (absent, or submitted blank) is never treated as "search for nothing,
  // find nothing" (I/O matrix) -- it behaves exactly like Story 1.3's unfiltered browse-all.
  const isSearching = query.length > 0;

  let papers: PaperSummary[] = [];
  let hasError = false;

  try {
    papers = isSearching ? await fetchSearchResults(query) : await fetchPapers();
  } catch (err) {
    // apps/api being unreachable (or returning something unexpected) must never crash or blank
    // the page (I/O matrix, "API unreachable") -- render a clear error state below instead. Still
    // logged server-side so an operator can actually diagnose why the fetch failed.
    console.error(
      isSearching
        ? `Failed to fetch search results for "${query}" from apps/api:`
        : 'Failed to fetch papers from apps/api:',
      err,
    );
    hasError = true;
  }

  // Every paper link rendered from a search result carries the current `?q=` forward, so the
  // Reader page's back-link knows what was searched for (this story's Boundaries).
  const paperHref = (paperNumber: number) =>
    isSearching
      ? `/papers/${paperNumber}?q=${encodeURIComponent(query)}`
      : `/papers/${paperNumber}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-12">
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-foreground">
          Federalist Research
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Explore the Federalist Papers with source-grounded AI.
        </p>
      </header>

      {/* "Ask the Archive" + Answer section (Story 3.1/3.2) -- a self-contained functional unit
          rendered above Quick Find/Browse Papers, per ui-design.md's Main Page section ordering.
          The two-column layout (search+answer left, sources right) is explicitly Story 3.3's
          scope, not this one's -- everything here stacks in a single column for now. */}
      <div className="mb-10">
        <AskQuestion />
      </div>

      <div className="mb-6 space-y-3">
        <QuickFindSearch />
        {isSearching && (
          <Link
            href="/"
            className="inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Back to all papers
          </Link>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {isSearching ? `Search results for '${query}'` : 'Browse Papers'}
          </CardTitle>
          <CardDescription>
            {isSearching
              ? // `hasError` is checked first and independently of `papers.length === 0`: a
                // genuine apps/api failure during a search is not "no results" (that's a search
                // that completed with zero matches) -- `CardContent` below already renders the
                // real `<ApiUnreachableNotice />` for the error case, so this description says
                // nothing rather than making a false "no results" claim on top of it.
                hasError
                ? null
                : papers.length === 0
                  ? `No results for '${query}'.`
                  : `${papers.length} paper${papers.length === 1 ? '' : 's'} matched '${query}'.`
              : hasError || papers.length === 0
                ? 'All of the Federalist Papers, in order.'
                : `All ${papers.length} Federalist Papers, in order.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasError && <ApiUnreachableNotice />}

          {!hasError && papers.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {isSearching
                ? `No papers matched '${query}'.`
                : 'No papers have been ingested yet.'}
            </p>
          )}

          {!hasError && papers.length > 0 && (
            <ul className="divide-y divide-border">
              {papers.map((paper) => (
                <li key={paper.paperNumber}>
                  <Button
                    asChild
                    variant="ghost"
                    className="h-auto w-full justify-start gap-4 rounded-md px-3 py-3 text-left font-normal"
                  >
                    <Link href={paperHref(paper.paperNumber)}>
                      <span className="w-14 shrink-0 font-mono text-sm text-muted-foreground">
                        No. {paper.paperNumber}
                      </span>
                      {/* min-w-0 overrides the flex item's default min-width:auto, which would
                          otherwise force this column to grow to fit its unwrapped content instead
                          of shrinking -- flex-1 then lets it fill the row's remaining width so
                          long titles have room to wrap onto a second line rather than overflowing
                          past the row (inherited from the parent Button's `whitespace-nowrap`,
                          which this span's own `whitespace-normal` overrides just for this text). */}
                      <span className="flex min-w-0 flex-1 flex-col whitespace-normal">
                        <span className="font-medium text-foreground">
                          {paper.title}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {Array.isArray(paper.authors) && paper.authors.length > 0
                            ? paper.authors.join(', ')
                            : 'Unknown author'}
                        </span>
                      </span>
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
