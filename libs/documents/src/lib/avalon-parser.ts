import * as cheerio from 'cheerio';

/**
 * Every one of the 85 Federalist Papers is credited to some combination of these three names as
 * they appear, in full caps, in Avalon's heading markup -- including jointly/disputed papers
 * (live-verified for Nos. 18-20 and 62-63, per this story's own task; historical record credits
 * several others jointly/disputedly too, e.g. Nos. 49-58, but those weren't live-fetched or
 * fixture-tested here). `displayName` is the canonical, presentable form stored as the
 * `Author.name`.
 */
const KNOWN_AUTHORS: ReadonlyArray<{ pattern: string; displayName: string }> = [
  { pattern: 'HAMILTON', displayName: 'Hamilton' },
  { pattern: 'MADISON', displayName: 'Madison' },
  { pattern: 'JAY', displayName: 'Jay' },
];

// A heading line that is a publication byline ("For the Independent Journal.", "From the New
// York Packet. Friday, ...", "From McLEAN'S Edition, New York.") rather than part of the title
// -- verified against every byline phrasing across a broad live sample of the 85 papers.
const BYLINE_LINE = /^(for|from)\b/i;

// A heading line that is a bare publication date, carried onto its own line by a stray <BR>
// (e.g. "From the New York Packet.<BR>Friday, December 28, 1787.").
const DATE_LINE = /^[A-Za-z]+day,\s+\w+\s+\d{1,2},\s+\d{4}\.?$/;

// Avalon's page for No. 70 republishes a second, textually different historical printing under
// a "Different Version of No. 70" heading further down the same page. Truncate before any such
// marker so it's never parsed as part of the canonical text (verified live -- without this, No.
// 70's heading and fullText both silently double up). Scoped to paperNumber === 70 explicitly
// (rather than applied to every paper) since no other paper's real text was verified to contain
// this literal phrase -- an unscoped match would be a silent, un-reviewed risk for paper 1-69/71-85.
const ALTERNATE_VERSION_MARKER =
  /<H[0-9][^>]*>\s*(<A[^>]*>)?\s*Different Version/i;
const ALTERNATE_VERSION_PAPER_NUMBER = 70;

// Avalon's footnote paragraphs end with a "Return to the Text" back-link to the citing footnote
// marker -- navigational chrome, not part of Publius's actual writing.
const FOOTNOTE_BACKLINK_SELECTOR = 'a[href^="#back"]';

export interface ParsedPaper {
  paperNumber: number;
  title: string;
  authors: string[];
  fullText: string;
}

/**
 * Parses one Avalon Project Federalist Paper page (`avalon.law.yale.edu/18th_century/fed{NN}.asp`
 * HTML) into its number, title, credited author(s), and full text. Pure parsing, no I/O --
 * `apps/api`'s ingestion orchestrator performs the HTTP fetch and passes the resulting HTML in.
 */
export function parseAvalonPaper(
  html: string,
  paperNumber: number,
): ParsedPaper {
  const marker =
    paperNumber === ALTERNATE_VERSION_PAPER_NUMBER
      ? html.search(ALTERNATE_VERSION_MARKER)
      : -1;
  const truncated = marker >= 0 ? html.slice(0, marker) : html;

  const $ = cheerio.load(truncated);
  $(FOOTNOTE_BACKLINK_SELECTOR).remove();

  const headingText = $('h3, h4')
    .map((_, el) => $(el).text())
    .get()
    .join(' ');

  const authors = KNOWN_AUTHORS.filter(({ pattern }) =>
    new RegExp(`\\b${pattern}\\b`, 'i').test(headingText),
  ).map(({ displayName }) => displayName);

  if (authors.length === 0) {
    throw new Error(
      `No recognizable author found in heading for paper ${paperNumber}`,
    );
  }

  const authorPattern = new RegExp(
    `\\b(${KNOWN_AUTHORS.map(({ pattern }) => pattern).join('|')})\\b`,
    'i',
  );
  const title = headingText
    .split(/\s{2,}|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !authorPattern.test(line.replace(/\bOR\b|\bAND\b/gi, '')))
    .filter((line) => !BYLINE_LINE.test(line))
    .filter((line) => !DATE_LINE.test(line))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!title) {
    throw new Error(
      `No title could be extracted from heading for paper ${paperNumber}`,
    );
  }

  const fullText = $('p')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((text) => text.length > 0)
    .join('\n\n');

  return { paperNumber, title, authors, fullText };
}
