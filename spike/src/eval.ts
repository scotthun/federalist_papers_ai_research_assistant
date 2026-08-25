import { readFileSync } from 'node:fs';
import { generateEmbedding } from './ai.js';
import { retrieveRelevantChunks } from './db.js';

interface EvalCase {
  question: string;
  expectedPapers: number[];
}

const TOP_K = 5;

async function runEval(): Promise<boolean> {
  const cases: EvalCase[] = JSON.parse(readFileSync(new URL('../eval-dataset.json', import.meta.url), 'utf-8'));
  let allPassed = true;

  for (const testCase of cases) {
    const start = Date.now();
    const queryEmbedding = await generateEmbedding(testCase.question);
    const results = await retrieveRelevantChunks(queryEmbedding, TOP_K);
    const retrievedPapers = new Set(results.map((r) => r.paperNumber));
    const hit = testCase.expectedPapers.some((p) => retrievedPapers.has(p));

    console.log(
      JSON.stringify({
        event: 'eval',
        question: testCase.question,
        expectedPapers: testCase.expectedPapers,
        retrievedPapers: [...retrievedPapers],
        scores: results.map((r) => Number(r.score.toFixed(4))),
        hit,
        latencyMs: Date.now() - start,
      }),
    );

    if (!hit) allPassed = false;
  }

  return allPassed;
}

runEval()
  .then((passed) => {
    console.log(passed ? '\nEVAL PASSED: all questions found their expected paper in top-K' : '\nEVAL FAILED: see misses above');
    process.exit(passed ? 0 : 1);
  })
  .catch((err) => {
    console.error('Eval run failed:', err);
    process.exit(1);
  });
