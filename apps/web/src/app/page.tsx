import Link from 'next/link';
import type { PaperSummary } from '@federalist-research/shared';
import { ApiUnreachableNotice } from '@/components/api-unreachable-notice';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { API_FETCH_TIMEOUT_MS, resolveApiBaseUrl } from '@/lib/api-client';

async function fetchPapers(): Promise<PaperSummary[]> {
  const baseUrl = resolveApiBaseUrl();

  const response = await fetch(`${baseUrl}/papers`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`GET /papers responded with status ${response.status}`);
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    // A malformed 2xx body must fail the same way an unreachable API does (I/O matrix, "API
    // unreachable") rather than throwing further downstream (e.g. inside .map()) once rendering
    // has already started.
    throw new Error('GET /papers responded with a non-array body');
  }

  return body as PaperSummary[];
}

export default async function BrowsePapersPage() {
  let papers: PaperSummary[] = [];
  let hasError = false;

  try {
    papers = await fetchPapers();
  } catch (err) {
    // apps/api being unreachable (or returning something unexpected) must never crash or blank
    // the page (I/O matrix, "API unreachable") -- render a clear error state below instead. Still
    // logged server-side so an operator can actually diagnose why the fetch failed.
    console.error('Failed to fetch papers from apps/api:', err);
    hasError = true;
  }

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

      <Card>
        <CardHeader>
          <CardTitle>Browse Papers</CardTitle>
          <CardDescription>
            {hasError || papers.length === 0
              ? 'All of the Federalist Papers, in order.'
              : `All ${papers.length} Federalist Papers, in order.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasError && <ApiUnreachableNotice />}

          {!hasError && papers.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No papers have been ingested yet.
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
                    <Link href={`/papers/${paper.paperNumber}`}>
                      <span className="w-14 shrink-0 font-mono text-sm text-muted-foreground">
                        No. {paper.paperNumber}
                      </span>
                      <span className="flex flex-col">
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
