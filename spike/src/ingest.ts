import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseAvalonPaper } from './avalon-parser.js';
import { chunkText } from './chunker.js';
import { generateEmbedding } from './ai.js';
import { upsertPaper, replaceChunks } from './db.js';

const execFileAsync = promisify(execFile);
const SAMPLE_PAPERS = [1, 10, 51];

// Node's native fetch fails TLS verification in this environment (a corporate root CA
// that curl trusts via the system keychain but Node's bundled CA store doesn't). Shelling
// out to curl sidesteps debugging Node's trust store for throwaway spike code.
async function fetchViaCurl(url: string): Promise<string> {
  const { stdout } = await execFileAsync('curl', ['-sS', '-f', url], { maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

async function ingestPaper(paperNumber: number): Promise<void> {
  const padded = String(paperNumber).padStart(2, '0');
  const sourceUrl = `https://avalon.law.yale.edu/18th_century/fed${padded}.asp`;

  const start = Date.now();
  const html = await fetchViaCurl(sourceUrl);

  const parsed = parseAvalonPaper(html, paperNumber);

  const paper = await upsertPaper({
    paperNumber: parsed.paperNumber,
    title: parsed.title,
    authors: parsed.authors,
    sourceUrl,
    fullText: parsed.fullText,
  });

  const chunks = chunkText(parsed.fullText, { targetWords: 750, maxWords: 1000 });

  const embedded = await Promise.all(
    chunks.map(async (content, chunkIndex) => ({
      chunkIndex,
      content,
      embedding: await generateEmbedding(content),
    })),
  );

  await replaceChunks(paper.id, embedded);

  console.log(
    JSON.stringify({
      event: 'ingest',
      paperNumber,
      authors: parsed.authors,
      chunkCount: chunks.length,
      latencyMs: Date.now() - start,
    }),
  );
}

async function main() {
  for (const paperNumber of SAMPLE_PAPERS) {
    await ingestPaper(paperNumber);
  }
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
