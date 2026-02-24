import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHttpRouter } from '../src/routes/http.js';
import { GameEngine } from '../src/game/gameEngine.js';

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

function createEngineStub(): { engine: GameEngine; updateConfig: ReturnType<typeof vi.fn> } {
  const updateConfig = vi.fn();
  const getPublicState = vi.fn(() => ({
    phase: 'LOBBY',
    config: {
      rounds: 3,
      investigationSeconds: 180,
      scoringSeconds: 60,
      vaultStart: 4,
      insiderEnabled: true,
      pollIntervalMs: 2000,
      excelPath: '/tmp/workbook.xlsx',
      excelShareUrl: '',
      ackWritesEnabled: false,
      startingDealerSeatIndex: 0
    },
    preflight: {
      confirmedLocalAvailability: true,
      confirmedDesktopExcelClosed: true,
      preflightPassed: true
    },
    players: [],
    round: {
      roundNumber: 0,
      dealerSeatIndex: 0,
      currentTurnSeatIndex: 0,
      dealerId: null,
      vaultValue: 0,
      calledBy: null,
      questions: [],
      roundCode: '',
      investigationEndsAt: null,
      scoringEndsAt: null,
      submissions: {},
      submissionTracker: {},
      latestResult: null
    },
    teamScores: { A: 0, B: 0 },
    history: [],
    workbook: {
      activePath: '/tmp/workbook.xlsx',
      lastMtimeMs: null,
      alerts: []
    },
    demo: {
      status: 'IDLE',
      targetDurationSeconds: 60
    },
    lastActions: {}
  }));

  return {
    engine: {
      updateConfig,
      getPublicState
    } as unknown as GameEngine,
    updateConfig
  };
}

describe('workbook env-lock routes', () => {
  it('rejects excelPath override on config update', async () => {
    const { engine, updateConfig } = createEngineStub();
    const app = createApp(engine);

    const response = await request(app).put('/api/config').send({
      rounds: 2,
      excelPath: '/tmp/override.xlsx'
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('env-locked');
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it('rejects excelShareUrl override on config update', async () => {
    const { engine, updateConfig } = createEngineStub();
    const app = createApp(engine);

    const response = await request(app).put('/api/config').send({
      excelShareUrl: 'https://example.com/workbook'
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('env-locked');
    expect(updateConfig).not.toHaveBeenCalled();
  });

  it('disables workbook select-path endpoint', async () => {
    const { engine } = createEngineStub();
    const app = createApp(engine);

    const response = await request(app).post('/api/workbook/select-path').send({
      path: '/tmp/override.xlsx'
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('env-locked');
  });
});
