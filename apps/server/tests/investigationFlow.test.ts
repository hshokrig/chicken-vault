import { afterEach, describe, expect, it } from 'vitest';
import { computeSeatAfter, GameEngine } from '../src/game/gameEngine.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

async function setupEngineWithPlayers(insiderEnabled = false): Promise<GameEngine> {
  const workbookDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chicken-vault-'));
  const workbookPath = path.join(workbookDir, 'docs', 'test.xlsx');
  await fs.mkdir(path.dirname(workbookPath), { recursive: true });
  const sourceWorkbookPath = path.resolve(process.cwd(), '..', '..', 'docs', 'chicken-vaults.xlsx');
  await fs.copyFile(sourceWorkbookPath, workbookPath);
  process.env.ONE_DRIVE_XLSX_PATH = workbookPath;

  const engine = new GameEngine({
    onState: () => {},
    onToast: () => {}
  });

  engine.setPreflight({
    confirmedLocalAvailability: true,
    confirmedDesktopExcelClosed: true
  });

  engine.addPlayer({ name: 'Ava', team: 'A' });
  engine.addPlayer({ name: 'Bo', team: 'B' });
  engine.addPlayer({ name: 'Cy', team: 'A' });

  engine.updateConfig({
    insiderEnabled
  });

  await engine.initializeWorkbook();
  return engine;
}

afterEach(() => {
  delete process.env.ONE_DRIVE_XLSX_PATH;
});

describe('investigation turn progression', () => {
  it('auto-selects secret card and insider when investigation starts from setup', async () => {
    const engine = await setupEngineWithPlayers(true);
    await engine.startGame();

    engine.startInvestigation();

    const state = engine.getPublicState();
    expect(state.phase).toBe('INVESTIGATION');

    const internal = engine as unknown as {
      state: {
        roundPrivate: { secretCard: string | null; insiderId: string | null };
      };
    };

    expect(internal.state.roundPrivate.secretCard).toMatch(/^[A2-9TJQK][SHDC]$/);
    expect(internal.state.roundPrivate.insiderId).toBeTruthy();
  });

  it('begins at seat after dealer and advances each question', async () => {
    const engine = await setupEngineWithPlayers();
    await engine.startGame();

    engine.setSecretCard('QD');
    engine.startInvestigation();

    const initial = engine.getPublicState();
    expect(initial.round.dealerSeatIndex).toBeGreaterThanOrEqual(0);
    expect(initial.round.dealerSeatIndex).toBeLessThan(initial.players.length);
    expect(initial.round.currentTurnSeatIndex).toBe(computeSeatAfter(initial.round.dealerSeatIndex, initial.players.length));

    const firstTurn = initial.round.currentTurnSeatIndex;
    engine.resolveQuestion({ question: 'Is it red?', answer: 'YES' });
    expect(engine.getPublicState().round.currentTurnSeatIndex).toBe(computeSeatAfter(firstTurn, initial.players.length));

    const secondTurn = engine.getPublicState().round.currentTurnSeatIndex;
    engine.resolveQuestion({ question: 'Is it a face card?', answer: 'YES' });
    expect(engine.getPublicState().round.currentTurnSeatIndex).toBe(computeSeatAfter(secondTurn, initial.players.length));
  });
});

describe('start real game after demo', () => {
  it('resets from DONE to round 1 setup with cleared scores/history', async () => {
    const engine = await setupEngineWithPlayers();

    const internal = engine as unknown as {
      state: {
        phase: string;
        teamScores: { A: number; B: number };
        history: unknown[];
      };
    };

    internal.state.phase = 'DONE';
    internal.state.teamScores = { A: 12, B: -3 };
    internal.state.history = [{ roundNumber: 1 }];

    await engine.startRealGameAfterDemo();

    const next = engine.getPublicState();
    expect(next.phase).toBe('SETUP');
    expect(next.round.roundNumber).toBe(1);
    expect(next.teamScores).toEqual({ A: 0, B: 0 });
    expect(next.history).toEqual([]);
  });
});

describe('reset game', () => {
  it('resets active game to lobby and clears round state', async () => {
    const engine = await setupEngineWithPlayers(true);
    await engine.startGame();
    engine.startInvestigation();

    engine.resetGameToLobby();
    const state = engine.getPublicState();

    expect(state.phase).toBe('LOBBY');
    expect(state.round.roundNumber).toBe(0);
    expect(state.round.questions).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.teamScores).toEqual({ A: 0, B: 0 });
  });
});
