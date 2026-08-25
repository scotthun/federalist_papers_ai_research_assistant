import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAvalonPaper } from './avalon-parser';

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
}

describe('parseAvalonPaper', () => {
  it('parses a single-author paper (No. 1)', () => {
    const result = parseAvalonPaper(fixture('fed01.html'), 1);
    expect(result.paperNumber).toBe(1);
    expect(result.authors).toEqual(['Hamilton']);
    expect(result.title).toBe('General Introduction');
    expect(result.fullText).toMatch(/^To the People of the State of New York:/);
    expect(result.fullText).toMatch(/PUBLIUS\./);
    // footer nav text must not leak into the body
    expect(result.fullText).not.toMatch(/Next Document/);
    expect(result.fullText).not.toMatch(/Avalon Home/);
    // the byline used to get folded into the title -- must not leak in either
    expect(result.title).not.toMatch(/Independent Journal/);
    // nor the footnote back-link
    expect(result.fullText).not.toMatch(/Return to the Text/);
  });

  it('parses a single-author paper with a longer heading (No. 10)', () => {
    const result = parseAvalonPaper(fixture('fed10.html'), 10);
    expect(result.paperNumber).toBe(10);
    expect(result.authors).toEqual(['Madison']);
    expect(result.title).toMatch(/Union as a Safeguard/);
    expect(result.title).not.toMatch(/New York Packet/);
    expect(result.fullText).toMatch(/AMONG the numerous advantages/);
  });

  it('parses a disputed-authorship paper credited in a separate heading block (No. 51)', () => {
    const result = parseAvalonPaper(fixture('fed51.html'), 51);
    expect(result.paperNumber).toBe(51);
    expect(result.authors).toEqual(['Hamilton', 'Madison']);
    expect(result.title).toBe(
      'The Structure of the Government Must Furnish the Proper Checks and Balances Between the Different Departments',
    );
    expect(result.fullText).toMatch(
      /Ambition must be made to counteract ambition/,
    );
  });

  it.each([18, 19, 20])(
    'parses disputed-authorship paper No. %i (Hamilton/Madison, credited "AND")',
    (paperNumber) => {
      const result = parseAvalonPaper(
        fixture(`fed${String(paperNumber).padStart(2, '0')}.html`),
        paperNumber,
      );
      expect(result.authors).toEqual(['Hamilton', 'Madison']);
      expect(result.title).toMatch(/Insufficiency/);
      expect(result.title).not.toMatch(/Independent Journal|New York Packet/);
      expect(result.fullText).toMatch(
        /^To the People of the State of New York:/,
      );
      expect(result.fullText).toMatch(/PUBLIUS\./);
    },
  );

  it.each([62, 63])(
    'parses disputed-authorship paper No. %i (Hamilton/Madison, credited "OR")',
    (paperNumber) => {
      const result = parseAvalonPaper(
        fixture(`fed${paperNumber}.html`),
        paperNumber,
      );
      expect(result.authors).toEqual(['Hamilton', 'Madison']);
      expect(result.title).toMatch(/The Senate/);
      expect(result.fullText).toMatch(
        /^To the People of the State of New York:/,
      );
      expect(result.fullText).toMatch(/PUBLIUS\./);
    },
  );

  it('truncates No. 70 before its alternate historical version rather than duplicating content', () => {
    const result = parseAvalonPaper(fixture('fed70.html'), 70);
    expect(result.authors).toEqual(['Hamilton']);
    expect(result.title).toBe('The Executive Department Further Considered');
    expect(result.fullText).not.toMatch(/Different Version of No\. 70/);
    // the alternate printing repeats this phrase; it must appear at most once in the kept text
    const occurrences = result.fullText.split('vigorous Executive').length - 1;
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  it('throws on content with no recognizable author', () => {
    expect(() =>
      parseAvalonPaper('<html><body><p>no heading here</p></body></html>', 99),
    ).toThrow();
  });

  it('throws when no title can be extracted (heading has only an author name)', () => {
    expect(() =>
      parseAvalonPaper(
        '<html><body><h3>HAMILTON</h3><p>content</p></body></html>',
        5,
      ),
    ).toThrow(/No title/);
  });

  it('only truncates at the alternate-version marker for paper 70, not other papers', () => {
    const html = `
      <html><body>
        <h3>Some Title<br>
        HAMILTON</h3>
        <p>Real content before.</p>
        <h4>Different Version of No. 5</h4>
        <p>Content that would be lost if the marker weren't scoped to paper 70.</p>
      </body></html>
    `;
    const result = parseAvalonPaper(html, 5);
    expect(result.fullText).toContain(
      "Content that would be lost if the marker weren't scoped to paper 70.",
    );
  });

  it.each(Array.from({ length: 85 }, (_, i) => i + 1))(
    'parses paper No. %i from a live-fetched fixture without throwing',
    (paperNumber) => {
      const html = fixture(`fed${String(paperNumber).padStart(2, '0')}.html`);
      const result = parseAvalonPaper(html, paperNumber);
      expect(result.paperNumber).toBe(paperNumber);
      expect(result.title.length).toBeGreaterThan(0);
      expect(result.authors.length).toBeGreaterThan(0);
      expect(result.authors.every((a) => ['Hamilton', 'Madison', 'Jay'].includes(a))).toBe(true);
      expect(result.fullText.length).toBeGreaterThan(0);
      expect(result.fullText).not.toMatch(/Return to the Text/);
      expect(result.fullText).not.toMatch(/Next Document|Avalon Home/);
    },
  );
});
