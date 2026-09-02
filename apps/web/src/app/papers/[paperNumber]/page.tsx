import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  parsePaperNumberRouteSegment,
  type PaperDetail,
} from '@federalist-research/shared';
import { ApiUnreachableNotice } from '@/components/api-unreachable-notice';
import { AnnouncePaperContext } from '@/components/quill/announce-paper-context';
import { Card, CardContent } from '@/components/ui/card';
import { API_FETCH_TIMEOUT_MS, resolveApiBaseUrl } from '@/lib/api-client';

type FetchPaperDetailResult =
  | { status: 'ok'; paper: PaperDetail }
  | { status: 'not-found' }
  | { status: 'error' };

function isPaperDetail(body: unknown): body is PaperDetail {
  if (typeof body !== 'object' || body === null) return false;
  const candidate = body as Record<string, unknown>;
  return (
    typeof candidate.paperNumber === 'number' &&
    Number.isFinite(candidate.paperNumber) &&
    typeof candidate.title === 'string' &&
    Array.isArray(candidate.authors) &&
    candidate.authors.every((author) => typeof author === 'string') &&
    typeof candidate.fullText === 'string' &&
    // A non-empty string, not just typeof === 'string' -- an empty sourceUrl would otherwise pass
    // and render a verification link pointing at the current page instead of a real source.
    typeof candidate.sourceUrl === 'string' &&
    candidate.sourceUrl.length > 0
  );
}

async function fetchPaperDetail(
  paperNumber: number,
): Promise<FetchPaperDetailResult> {
  const baseUrl = resolveApiBaseUrl();

  let response: Response;
  let body: unknown;
  try {
    response = await fetch(`${baseUrl}/papers/${paperNumber}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
    });

    // apps/api returns a real 404 for a nonexistent paperNumber -- surfaced as Next's own
    // notFound() by the caller, not folded into the generic error state below.
    if (response.status === 404) {
      return { status: 'not-found' };
    }

    if (!response.ok) {
      console.error(
        `GET /papers/${paperNumber} responded with status ${response.status}`,
      );
      return { status: 'error' };
    }

    // Parsing the body is inside this same try/catch (not a separate one after it) -- a
    // non-JSON 2xx body (malformed proxy response, empty body, etc.) must fail the same way an
    // unreachable API does, not throw uncaught and crash the page.
    body = await response.json();
  } catch (err) {
    // apps/api being unreachable, timing out, or returning an unparsable body must never crash
    // or blank the page (I/O matrix, "API unreachable") -- the caller renders a clear error state
    // instead. Still logged server-side so an operator can actually diagnose the failure.
    console.error(`Failed to fetch paper ${paperNumber} from apps/api:`, err);
    return { status: 'error' };
  }

  if (!isPaperDetail(body)) {
    // A malformed 2xx body must fail the same way an unreachable API does, rather than throwing
    // further downstream once rendering has already started (mirrors src/app/page.tsx).
    console.error(
      `GET /papers/${paperNumber} responded with an unexpected body`,
    );
    return { status: 'error' };
  }

  return { status: 'ok', paper: body };
}

/** Collapses all whitespace runs (including newlines) to a single space and trims -- lets a
 * `highlight` value copied from a citation's `quotedPassage` match against `fullText` even though
 * the two may have been through different whitespace normalization (e.g. the stored text's
 * `\n\n` paragraph breaks) without requiring an exact byte-for-byte match. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Next.js App Router page-prop convention: `searchParams` is always a `Promise` (same as
 * `params`). Defaulted so direct test invocations that omit it entirely (this page's
 * pre-Story-2.1 tests) keep working unchanged -- Next itself always supplies a real value at
 * request time, so the default never applies outside a test. */
export default async function PaperReaderPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ paperNumber: string }>;
  searchParams?: Promise<{ q?: string | string[]; highlight?: string | string[] }>;
}) {
  const { paperNumber: rawPaperNumber } = await params;
  const paperNumber = parsePaperNumberRouteSegment(rawPaperNumber);

  // A non-numeric route segment (e.g. /papers/abc, or Number()-lenient lookalikes like
  // /papers/0x10, /papers/1e2, /papers/1.0) is handled the same as "not found" -- never a crash
  // (I/O matrix, "Non-numeric route segment"). Checked before any fetch is attempted.
  if (paperNumber === null) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const rawQuery = resolvedSearchParams.q;
  const query = (Array.isArray(rawQuery) ? rawQuery[0] ?? '' : rawQuery ?? '').trim();
  // A repeated `?highlight=&highlight=` would arrive as string[] -- only the first value is ever
  // meaningful here (same convention as `q` above). Absent/whitespace-only means "no highlight",
  // never a crash or a no-op match against every paragraph.
  const rawHighlight = resolvedSearchParams.highlight;
  const highlight = (
    Array.isArray(rawHighlight) ? rawHighlight[0] ?? '' : rawHighlight ?? ''
  ).trim();
  // When the reader was reached from a search result, the back-link should return to those
  // results, not the generic unfiltered Browse Papers list (this story's Boundaries).
  const hasSearchContext = query.length > 0;
  const backLinkHref = hasSearchContext ? `/?q=${encodeURIComponent(query)}` : '/';
  const backLinkLabel = hasSearchContext
    ? `← Back to results for '${query}'`
    : '← Browse Papers';

  const result = await fetchPaperDetail(paperNumber);

  if (result.status === 'not-found') {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link
        href={backLinkHref}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {backLinkLabel}
      </Link>

      {result.status === 'error' ? (
        <Card className="mt-8">
          <CardContent className="pt-6">
            <ApiUnreachableNotice />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Tells the layout-level QuillWidget which paper is currently being read (Story 5.2)
              -- rendered only on the success branch, matching "this page is a paper" exactly. */}
          <AnnouncePaperContext
            paperNumber={result.paper.paperNumber}
            title={result.paper.title}
          />
          <PaperReader paper={result.paper} highlight={highlight} />
        </>
      )}
    </main>
  );
}

function PaperReader({ paper, highlight }: { paper: PaperDetail; highlight: string }) {
  // Story 1.2's parser joins paragraphs with "\n\n" -- split back apart so the full text renders
  // as real paragraphs, not one unbroken block (Boundaries: "paragraph breaks preserved").
  // Blank/whitespace-only segments (from leading/trailing or repeated blank-line sequences in the
  // stored text) are filtered out so they don't produce stray empty <p> tags.
  const paragraphs = paper.fullText
    .split('\n\n')
    .filter((paragraph) => paragraph.trim().length > 0);

  // A citation link's `highlight` (a `quotedPassage` copied verbatim from a chunk, Story 5.1)
  // matches whichever paragraph contains it after both sides are whitespace-normalized -- only
  // the *first* match is tagged, matching the AC's "the matched paragraph" (singular).
  const normalizedHighlight = highlight.length > 0 ? normalizeWhitespace(highlight) : '';
  const highlightIndex =
    normalizedHighlight.length > 0
      ? paragraphs.findIndex((paragraph) =>
          normalizeWhitespace(paragraph).includes(normalizedHighlight),
        )
      : -1;

  return (
    <article className="mt-8">
      <header className="mb-8">
        <p className="font-mono text-sm text-muted-foreground">
          No. {paper.paperNumber}
        </p>
        <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-foreground">
          {paper.title}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          {paper.authors.length > 0
            ? paper.authors.join(', ')
            : 'Unknown author'}
        </p>
        {/* Quiet verification tag near the title (UX-DR9, decisions.md "Verification link
            placement") -- links to this paper's own stored sourceUrl, never a hardcoded or
            re-derived guess, and never placed inline per-passage or in a drawer. */}
        <a
          href={paper.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Source: Avalon Project ↗<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </header>

      <Card>
        <CardContent className="space-y-4 pt-6 font-serif text-base leading-relaxed text-foreground">
          {paragraphs.map((paragraph, index) =>
            // Index keys are safe here -- fullText is static per render, never reordered/edited.
            index === highlightIndex ? (
              <p
                key={index}
                id="cited-passage"
                className="-mx-2 rounded-md bg-quill-surface-highlight px-2"
              >
                {paragraph}
              </p>
            ) : (
              <p key={index}>{paragraph}</p>
            ),
          )}
        </CardContent>
      </Card>
    </article>
  );
}
