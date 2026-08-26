import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { AIProvider } from '@federalist-research/ai';
import { DataSource } from 'typeorm';
import { AI_PROVIDER } from '../ai-provider.provider';
import { AskController } from './ask.controller';
import { AskService } from './ask.service';
import { CLARIFY_THRESHOLD, CONFIDENT_THRESHOLD } from './answer-thresholds';

/**
 * Real-HTTP test for `POST /api/ask`'s wiring: AskController + AskService are the real classes
 * (only their DataSource/AIProvider dependencies are faked), assembled the same way AskModule
 * does, with the same global `api` prefix main.ts applies -- mirrors papers.http.spec.ts's
 * approach (an actual TCP request via `fetch`, not a direct function call).
 */
describe('POST /api/ask (HTTP wiring)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let fakeGenerateEmbedding: jest.Mock;
  let fakeGenerateStructuredOutput: jest.Mock;
  let fakeDbQuery: jest.Mock;

  const fakeRetrievedChunkRow = {
    chunkId: 'chunk-1',
    paperNumber: 51,
    paperTitle: 'The Structure of the Government',
    content: 'Ambition must be made to counteract ambition.',
    score: CONFIDENT_THRESHOLD,
  };

  beforeAll(async () => {
    fakeGenerateEmbedding = jest.fn().mockResolvedValue([0.1, 0.2, 0.3]);
    fakeGenerateStructuredOutput = jest.fn().mockResolvedValue({
      answer: 'Ambition must be made to counteract ambition.',
      citations: [{ paperNumber: 51, paperTitle: 'The Structure of the Government', chunkId: 'chunk-1' }],
    });
    fakeDbQuery = jest.fn().mockResolvedValue([fakeRetrievedChunkRow]);
    const fakeDataSource = { query: fakeDbQuery } as unknown as DataSource;
    const fakeAiProvider: AIProvider = {
      generateEmbedding: fakeGenerateEmbedding,
      generateStructuredOutput: fakeGenerateStructuredOutput,
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AskController],
      providers: [
        AskService,
        { provide: getDataSourceToken(), useValue: fakeDataSource },
        { provide: AI_PROVIDER, useValue: fakeAiProvider },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api'); // mirrors main.ts's app.setGlobalPrefix('api')
    await app.init();
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? address : address?.port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(() => {
    fakeGenerateEmbedding.mockClear();
    fakeGenerateStructuredOutput.mockClear();
    fakeDbQuery.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is reachable at the global-prefixed route and returns a full Answer for a confident-tier question', async () => {
    fakeDbQuery.mockResolvedValue([fakeRetrievedChunkRow]);

    const response = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Why checks and balances?' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      answer: 'Ambition must be made to counteract ambition.',
      citations: [{ paperNumber: 51, paperTitle: 'The Structure of the Government', chunkId: 'chunk-1' }],
      confidence: 'high',
      insufficientEvidence: false,
    });
  });

  it('is not reachable without the global prefix', async () => {
    const response = await fetch(`${baseUrl}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'anything' }),
    });

    expect(response.status).toBe(404);
  });

  it('returns 400 for a blank question without calling the embedding model or the LLM', async () => {
    const response = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '   ' }),
    });

    expect(response.status).toBe(400);
    expect(fakeGenerateEmbedding).not.toHaveBeenCalled();
    expect(fakeGenerateStructuredOutput).not.toHaveBeenCalled();
  });

  it('returns 400 when question is missing entirely', async () => {
    const response = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });

  // The marginal-score/clarify-tier path was previously only unit-tested against AskService
  // directly (ask.service.spec.ts), never exercised through a real HTTP round trip -- this
  // proves the tier's actual response shape reaches an HTTP client correctly.
  it('returns a clarify-tier 200 (best-guess citation, no LLM call) for a marginal top score', async () => {
    const midpoint = (CONFIDENT_THRESHOLD + CLARIFY_THRESHOLD) / 2;
    fakeDbQuery.mockResolvedValue([
      {
        chunkId: 'chunk-9',
        paperNumber: 39,
        paperTitle: 'The Conformity of the Plan to Republican Principles',
        content: 'Republican government content.',
        score: midpoint,
      },
    ]);

    const response = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Some vague question' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.confidence).toBe('low');
    expect(body.insufficientEvidence).toBe(true);
    expect(body.citations).toEqual([
      {
        paperNumber: 39,
        paperTitle: 'The Conformity of the Plan to Republican Principles',
        chunkId: 'chunk-9',
      },
    ]);
    expect(fakeGenerateStructuredOutput).not.toHaveBeenCalled();
  });

  it('returns a refuse-tier 200 (not a 500) when the top retrieved score is low, with no LLM call', async () => {
    fakeDbQuery.mockResolvedValue([{ ...fakeRetrievedChunkRow, score: -0.9 }]);

    const response = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What is the best pizza topping?' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.insufficientEvidence).toBe(true);
    expect(body.confidence).toBe('low');
    expect(body.citations).toEqual([]);
    expect(fakeGenerateStructuredOutput).not.toHaveBeenCalled();
  });

  // I/O Edge-Case Matrix: "Embedding/LLM provider call fails ... Clear error response ... Never
  // a hang." A real HTTP round trip proves Nest's default exception filter turns the rejected
  // promise into an actual 500 response, not a hang.
  it('returns a 500, not a hang, when the embedding call fails', async () => {
    fakeGenerateEmbedding.mockRejectedValueOnce(
      new Error('AI_PROVIDER is "gemini" but GEMINI_API_KEY is not set.'),
    );

    const response = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Why checks and balances?' }),
    });

    expect(response.status).toBe(500);
  });
});
