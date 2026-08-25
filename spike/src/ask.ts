import { generateEmbedding, generateGroundedAnswer } from './ai.js';
import { retrieveRelevantChunks } from './db.js';
import { answerWithVerification } from './answer.js';

const TOP_K = 5;

async function ask(question: string): Promise<void> {
  const start = Date.now();

  const queryEmbedding = await generateEmbedding(question);
  const retrieved = await retrieveRelevantChunks(queryEmbedding, TOP_K);

  const result = await answerWithVerification(question, retrieved, generateGroundedAnswer);

  // NFR9: lightweight logging -- query, retrieved paper numbers, similarity scores,
  // model/provider used, latency -- established here, extended in the real Story 3.1.
  console.log(
    JSON.stringify({
      event: 'ask',
      query: question,
      retrievedPaperNumbers: retrieved.map((r) => r.paperNumber),
      similarityScores: retrieved.map((r) => Number(r.score.toFixed(4))),
      provider: 'gemini',
      insufficientEvidence: result.insufficientEvidence,
      latencyMs: Date.now() - start,
    }),
  );

  console.log('\n--- ANSWER ---');
  console.log(result.answer);
  if (result.citations.length > 0) {
    console.log('\n--- CITATIONS ---');
    for (const c of result.citations) {
      console.log(`  [Federalist No. ${c.paperNumber}, chunk ${c.chunkId}] "${c.quotedPassage}"`);
    }
  }
}

const question = process.argv[2];
if (!question) {
  console.error('Usage: npm run ask -- "your question"');
  process.exit(1);
}

ask(question).catch((err) => {
  console.error('Ask failed:', err);
  process.exit(1);
});
