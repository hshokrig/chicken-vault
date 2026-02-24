import { Router } from 'express';
import { z } from 'zod';
import { GameEngine } from '../game/gameEngine.js';

const teamSchema = z.union([z.literal('A'), z.literal('B')]);

export function createHttpRouter(engine: GameEngine): Router {
  const router = Router();

  router.get('/state', (_req, res) => {
    res.json(engine.getPublicState());
  });

  router.put('/config', (req, res, next) => {
    try {
      const payload = z
        .object({
          rounds: z.number().int().optional(),
          investigationSeconds: z.number().int().optional(),
          scoringSeconds: z.number().int().optional(),
          vaultStart: z.number().int().optional(),
          insiderEnabled: z.boolean().optional(),
          pollIntervalMs: z.number().int().optional(),
          excelPath: z.string().optional(),
          excelShareUrl: z.string().optional(),
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

  router.post('/workbook/select-path', async (req, res, next) => {
    try {
      const payload = z
        .object({
          path: z.string().min(1)
        })
        .parse(req.body);
      await engine.selectWorkbookPath(payload.path);
      res.json(engine.getPublicState());
    } catch (error) {
      next(error);
    }
  });

  router.post('/game/start', async (_req, res, next) => {
    try {
      await engine.startGame();
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
