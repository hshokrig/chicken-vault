import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/gameEngine.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

async function setupEngineWithPlayers(): Promise<GameEngine> {
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
    excelPath: path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'chicken-vault-')), 'test.xlsx'),
    insiderEnabled: false
  });

  await engine.initializeWorkbook();
  return engine;
}

describe('investigation turn progression', () => {
  it('begins at seat after dealer and advances each question', async () => {
    const engine = await setupEngineWithPlayers();
    await engine.startGame();

    engine.setSecretCard('QD');
    engine.startInvestigation();

    const initial = engine.getPublicState();
    expect(initial.round.dealerSeatIndex).toBe(0);
    expect(initial.round.currentTurnSeatIndex).toBe(1);

    engine.resolveQuestion({ question: 'Is it red?', answer: 'YES' });
    expect(engine.getPublicState().round.currentTurnSeatIndex).toBe(2);

    engine.resolveQuestion({ question: 'Is it a face card?', answer: 'YES' });
    expect(engine.getPublicState().round.currentTurnSeatIndex).toBe(0);
  });
});
