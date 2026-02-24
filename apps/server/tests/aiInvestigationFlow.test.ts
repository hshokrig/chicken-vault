import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { GameEngine } from '../src/game/gameEngine.js';

async function setupEngineInInvestigation(secretCard: string): Promise<GameEngine> {
  const workbookDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chicken-vault-ai-'));
  const workbookPath = path.join(workbookDir, 'docs', 'chicken-vaults.xlsx');
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
    insiderEnabled: false
  });

  await engine.initializeWorkbook();
  await engine.startGame();
  engine.setSecretCard(secretCard);
  engine.startInvestigation();
  return engine;
}

function mockDecisionPayload(payload: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(payload)
            }
          }
        ]
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    )
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ONE_DRIVE_XLSX_PATH;
});

describe('AI investigation analysis', () => {
  it('resolves and advances turn on valid question', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockDecisionPayload({
      shouldRespond: true,
      editedQuestion: 'Is the card red?',
      answer: 'YES',
      ignoreReason: null
    });

    const engine = await setupEngineInInvestigation('QD');
    const before = engine.getPublicState();
    const beforeQuestionCount = before.round.questions.length;
    const beforeVaultValue = before.round.vaultValue;
    const beforeTurnSeat = before.round.currentTurnSeatIndex;
    const outcome = await engine.analyzeAndResolveFromTranscript('uh is it red?');
    const after = engine.getPublicState();

    expect(outcome.status).toBe('RESOLVED');
    expect(outcome.answer).toBe('YES');
    expect(after.round.questions).toHaveLength(beforeQuestionCount + 1);
    expect(after.round.vaultValue).toBe(beforeVaultValue + 1);
    expect(after.round.currentTurnSeatIndex).not.toBe(beforeTurnSeat);
  });

  it('uses structured LLM answer directly for rank comparison questions', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockDecisionPayload({
      shouldRespond: true,
      editedQuestion: 'Is the card number more than five?',
      answer: 'NO',
      ignoreReason: null
    });

    const engine = await setupEngineInInvestigation('8S');
    const outcome = await engine.analyzeAndResolveFromTranscript('Is the card number more than five?');

    expect(outcome.status).toBe('RESOLVED');
    expect(outcome.answer).toBe('NO');
  });

  it('uses structured LLM answer directly for exact rank equality questions', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockDecisionPayload({
      shouldRespond: true,
      editedQuestion: 'Is the card number four?',
      answer: 'YES',
      ignoreReason: null
    });

    const engine = await setupEngineInInvestigation('8S');
    const outcome = await engine.analyzeAndResolveFromTranscript('Is the card number four?');

    expect(outcome.status).toBe('RESOLVED');
    expect(outcome.answer).toBe('YES');
  });

  it('keeps same turn when transcript is rejected', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockDecisionPayload({
      shouldRespond: false,
      editedQuestion: '',
      answer: null,
      ignoreReason: 'CHATTER'
    });

    const engine = await setupEngineInInvestigation('7S');
    const before = engine.getPublicState();
    const beforeQuestionCount = before.round.questions.length;
    const beforeVaultValue = before.round.vaultValue;
    const beforeTurnSeat = before.round.currentTurnSeatIndex;
    const outcome = await engine.analyzeAndResolveFromTranscript('random people chatting');
    const after = engine.getPublicState();

    expect(outcome.status).toBe('RETRY');
    expect(outcome.reason).toBe('NO_VALID_QUESTION');
    expect(after.round.questions).toHaveLength(beforeQuestionCount);
    expect(after.round.vaultValue).toBe(beforeVaultValue);
    expect(after.round.currentTurnSeatIndex).toBe(beforeTurnSeat);
  });
});
