import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

const EMBEDDING_MODEL = 'gemini-embedding-001';
// gemini-2.5-flash returns 404 for new API keys as of 2026-08 ("no longer available to
// new users"); the API's own error pointed at this replacement.
const GENERATION_MODEL = 'gemini-3.6-flash';

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getClient().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
  });
  const values = response.embeddings?.[0]?.values;
  if (!values) throw new Error('Gemini returned no embedding values');
  return values;
}

export interface Citation {
  chunkId: number;
  paperNumber: number;
  quotedPassage: string;
}

export interface GroundedAnswer {
  answer: string;
  citations: Citation[];
}

export async function generateGroundedAnswer(
  question: string,
  context: Array<{ chunkId: number; paperNumber: number; paperTitle: string; content: string }>,
): Promise<GroundedAnswer> {
  const contextBlock = context
    .map((c) => `[chunkId=${c.chunkId}, paperNumber=${c.paperNumber}, title="${c.paperTitle}"]\n${c.content}`)
    .join('\n\n---\n\n');

  const prompt = `You are answering a question about the Federalist Papers using ONLY the evidence provided below. Do not use any outside knowledge. Every claim in your answer must be traceable to one of the provided passages.

EVIDENCE:
${contextBlock}

QUESTION: ${question}

Respond with a JSON object matching exactly this shape, and nothing else:
{
  "answer": "<your answer, grounded only in the evidence above>",
  "citations": [ { "chunkId": <number, must be one of the chunkId values shown above>, "paperNumber": <number>, "quotedPassage": "<short quote from that chunk supporting the answer>" } ]
}`;

  const response = await getClient().models.generateContent({
    model: GENERATION_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  });

  const text = response.text;
  if (!text) throw new Error('Gemini returned no text response');
  return JSON.parse(text) as GroundedAnswer;
}
