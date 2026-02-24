import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { GameEngine } from '../game/gameEngine.js';

const teamSchema = z.union([z.literal('A'), z.literal('B')]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

export function createHttpRouter(engine: GameEngine): Router {
  const router = Router();

  router.get('/state', (_req, res) => {
    res.json(engine.getPublicState());
  });

  router.put('/config', (req, res, next) => {
    try {
      if (
        req.body &&
        typeof req.body === 'object' &&
        ('excelPath' in (req.body as Record<string, unknown>) ||
          'excelShareUrl' in (req.body as Record<string, unknown>))
      ) {
        throw new Error('Workbook path is env-locked; set ONE_DRIVE_XLSX_PATH in .env.');
      }

      const payload = z
        .object({
          rounds: z.number().int().optional(),
          investigationSeconds: z.number().int().optional(),
          scoringSeconds: z.number().int().optional(),
          vaultStart: z.number().int().optional(),
          insiderEnabled: z.boolean().optional(),
          pollIntervalMs: z.number().int().optional(),
          ackWritesEnabled: z.boolean().optional()
        })
        .parse(req.body);
      engine.updateConfig(payload);
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.put('/preflight', (req, res, next) => {
    try {
      const payload = z
        .object({
          confirmedLocalAvailability: z.boolean(),
          confirmedDesktopExcelClosed: z.boolean()
        })
        .parse(req.body);
      engine.setPreflight(payload);
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/players', (req, res, next) => {
    try {
      const payload = z
        .object({
          name: z.string().min(1),
          team: teamSchema
        })
        .parse(req.body);
      const player = engine.addPlayer(payload);
      res.status(201).json(player);
    } catch (error) {
      next(error);
    }
  });

  router.put('/players/:playerId', (req, res, next) => {
    try {
      const payload = z
        .object({
          name: z.string().min(1).optional(),
          team: teamSchema.optional()
        })
        .parse(req.body);
      engine.updatePlayer(req.params.playerId, payload);
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.delete('/players/:playerId', (req, res, next) => {
    try {
      engine.removePlayer(req.params.playerId);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.put('/players/reorder', (req, res, next) => {
    try {
      const payload = z
        .object({
          playerIds: z.array(z.string()).min(1)
        })
        .parse(req.body);
      engine.reorderPlayers(payload.playerIds);
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/workbook/initialize', async (_req, res, next) => {
    try {
      await engine.initializeWorkbook();
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/workbook/select-path', (_req, _res, next) => {
    next(new Error('Workbook path is env-locked; set ONE_DRIVE_XLSX_PATH in .env.'));
  });

  router.post('/game/start', async (_req, res, next) => {
    try {
      await engine.startGame();
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/game/reset', (req, res, next) => {
    try {
      engine.resetGameToLobby();
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/game/start-real', async (_req, res, next) => {
    try {
      await engine.startRealGameAfterDemo();
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/game/demo/run', (req, res, next) => {
    try {
      engine.startDemo();
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/game/setup/secret-card', (req, res, next) => {
    try {
      const payload = z
        .object({
          card: z.string().min(2)
        })
        .parse(req.body);
      engine.setSecretCard(payload.card);
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/game/setup/pick-insider', (req, res, next) => {
    try {
      const reveal = engine.pickInsider();
      res.json(reveal);
    } catch (error) {
      next(error);
    }
  });

  router.post('/game/setup/start-investigation', (req, res, next) => {
    try {
      engine.startInvestigation();
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/game/investigation/resolve-question', (req, res, next) => {
    try {
      const payload = z
        .object({
          question: z.string().min(1),
          answer: z.union([z.literal('YES'), z.literal('NO')])
        })
        .parse(req.body);
      engine.resolveQuestion(payload);
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/game/investigation/analyze-question-audio', (req, res, next) => {
    upload.single('audio')(req, res, (uploadError: unknown) => {
      if (uploadError) {
        next(uploadError);
        return;
      }

      void (async () => {
        const file = req.file;
        if (!file?.buffer || file.buffer.length === 0) {
          throw new Error('Audio file is required.');
        }

        const outcome = await engine.analyzeAndResolveFromAudio({
          audioBuffer: file.buffer,
          mimeType: file.mimetype || 'audio/webm'
        });
        res.json(outcome);
      })().catch(next);
    });
  });

  router.post('/game/investigation/analyze-question-text', async (req, res, next) => {
    try {
      const isEnabled = process.env.ENABLE_AI_TEXT_TEST_ENDPOINT === 'true' || process.env.NODE_ENV !== 'production';
      if (!isEnabled) {
        throw new Error('Text analysis endpoint is disabled.');
      }

      const payload = z
        .object({
          transcript: z.string()
        })
        .parse(req.body);

      const outcome = await engine.analyzeAndResolveFromTranscript(payload.transcript);
      res.json(outcome);
    } catch (error) {
      next(error);
    }
  });

  router.post('/game/investigation/call-vault', async (req, res, next) => {
    try {
      const payload = z
        .object({
          calledBy: z.string().min(1).or(z.literal('AUTO'))
        })
        .parse(req.body);
      await engine.callVault(payload.calledBy);
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/game/reveal/next', (req, res, next) => {
    try {
      engine.nextRound();
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  return router;
}
