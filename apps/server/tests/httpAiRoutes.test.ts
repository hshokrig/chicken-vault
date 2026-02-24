import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiQuestionOutcome } from '@chicken-vault/shared';
import { createHttpRouter } from '../src/routes/http.js';
import { GameEngine } from '../src/game/gameEngine.js';

function createOutcome(overrides?: Partial<AiQuestionOutcome>): AiQuestionOutcome {
  return {
    status: 'RETRY',
    transcript: '',
    editedQuestion: null,
    answer: null,
    reason: 'NO_VALID_QUESTION',
    latencyMs: 10,
    ...overrides
  };
}

function createEngineStub(): {
  engine: GameEngine;
  analyzeAudio: ReturnType<typeof vi.fn>;
  analyzeText: ReturnType<typeof vi.fn>;
} {
  const analyzeAndResolveFromAudio = vi.fn(async () => createOutcome());
  const analyzeAndResolveFromTranscript = vi.fn(async () => createOutcome());
  const engine = {
    analyzeAndResolveFromAudio,
    analyzeAndResolveFromTranscript
  } as unknown as GameEngine;
  return {
    engine,
    analyzeAudio: analyzeAndResolveFromAudio,
    analyzeText: analyzeAndResolveFromTranscript
  };
}

function createApp(engine: GameEngine): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', createHttpRouter(engine));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    res.status(400).json({ error: message });
  });
  return app;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ENABLE_AI_TEXT_TEST_ENDPOINT;
  delete process.env.NODE_ENV;
});

describe('AI investigation routes', () => {
  it('rejects missing audio file', async () => {
    const { engine } = createEngineStub();
    const app = createApp(engine);

    const response = await request(app).post('/api/game/investigation/analyze-question-audio');

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Audio file is required');
  });

  it('analyzes uploaded audio when file is provided', async () => {
    const { engine, analyzeAudio } = createEngineStub();
    const app = createApp(engine);

    const response = await request(app)
      .post('/api/game/investigation/analyze-question-audio')
      .attach('audio', Buffer.from('fake-bytes'), 'question.webm');

    expect(response.status).toBe(200);
    expect(analyzeAudio).toHaveBeenCalledTimes(1);
  });

  it('blocks text analysis endpoint in production unless explicitly enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_AI_TEXT_TEST_ENDPOINT = 'false';
    const { engine } = createEngineStub();
    const app = createApp(engine);

    const response = await request(app).post('/api/game/investigation/analyze-question-text').send({
      transcript: 'Is it red?'
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('disabled');
  });
});
