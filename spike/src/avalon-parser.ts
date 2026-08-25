import * as cheerio from 'cheerio';

const KNOWN_AUTHORS = ['HAMILTON', 'MADISON', 'JAY'];

export interface ParsedPaper {
  paperNumber: number;
  title: string;
  authors: string[];
  fullText: string;
}

export function parseAvalonPaper(html: string, paperNumber: number): ParsedPaper {
  const $ = cheerio.load(html);

  const headingText = $('h3, h4')
    .map((_, el) => $(el).text())
    .get()
    .join(' ');

  const authors = KNOWN_AUTHORS.filter((name) =>
    new RegExp(`\\b${name}\\b`, 'i').test(headingText),
  );
  if (authors.length === 0) {
    throw new Error(`No recognizable author found in heading for paper ${paperNumber}`);
  }

  const authorPattern = new RegExp(`\\b(${KNOWN_AUTHORS.join('|')})\\b`, 'i');
  const title = headingText
    .split(/\s{2,}|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !authorPattern.test(line.replace(/\bOR\b|\bAND\b/gi, '')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const fullText = $('p')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((text) => text.length > 0)
    .join('\n\n');

  return { paperNumber, title, authors, fullText };
}
