import fs from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { GameStatePublic, TeamId } from '@chicken-vault/shared';
import { loadEnv } from '../src/utils/env.js';
import { parseCardCode, rankToWorkbookValue } from '../src/utils/cards.js';

loadEnv();

type SubmissionLevel = 'SAFE' | 'MEDIUM' | 'BOLD';

interface DemoRound {
  secretCard: string;
  transcripts: string[];
}

interface DemoOptions {
  baseUrl: string;
  rounds: DemoRound[];
  investigationSeconds: number;
  scoringSeconds: number;
  pollIntervalMs: number;
  submissionDelayMs: number;
}

const OPTIONS: DemoOptions = {
  baseUrl: 'http://localhost:4000',
  rounds: [
    {
      secretCard: 'QD',
      transcripts: [
        'uh okay, is the card red?',
        'is it a face card?',
        'everyone stop yelling and pass the water bottle',
        'is the suit diamonds?'
      ]
    },
    {
      secretCard: '7S',
      transcripts: ['is it black?', 'is the rank above ten?', 'lots of random chatter and no clear question', 'is it spades?']
    }
  ],
  investigationSeconds: 45,
  scoringSeconds: 20,
  pollIntervalMs: 1000,
  submissionDelayMs: 1000
};

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  // eslint-disable-next-line no-console
  console.log(`[ai-live-demo ${ts}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${OPTIONS.baseUrl}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...init
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `Request failed: ${response.status} ${response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function getState(): Promise<GameStatePublic> {
  return requestJson<GameStatePublic>('/api/state');
}

async function waitForPhase(phase: GameStatePublic['phase'], timeoutMs: number): Promise<GameStatePublic> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await getState();
    if (state.phase === phase) {
      return state;
    }
    await sleep(250);
  }

  const current = await getState();
  throw new Error(`Timed out waiting for phase ${phase}. Current phase=${current.phase}`);
}

async function removeAllPlayers(state: GameStatePublic): Promise<void> {
  for (const player of state.players) {
    await requestJson<void>(`/api/players/${player.id}`, { method: 'DELETE' });
  }
}

async function requireWorkbookPathFromEnv(): Promise<string> {
  const raw = process.env.ONE_DRIVE_XLSX_PATH?.trim() ?? '';
  if (!raw) {
    throw new Error('ONE_DRIVE_XLSX_PATH is required for AI demo simulation.');
  }

  const resolved = path.resolve(raw);
  await fs.stat(resolved);
  return resolved;
}

function ensureCell(sheet: XLSX.WorkSheet, address: string, value: string | number): void {
  sheet[address] = {
    t: typeof value === 'number' ? 'n' : 's',
    v: value
  };
}

function getColorFromSuit(suit: string): 'RED' | 'BLACK' {
  return suit === 'H' || suit === 'D' ? 'RED' : 'BLACK';
}

function buildSubmission(secretCard: string, seatIndex: number): { level: SubmissionLevel; guess: string } {
  const suit = secretCard.slice(-1);
  const color = getColorFromSuit(suit);
  const levelMap: SubmissionLevel[] = ['SAFE', 'MEDIUM', 'BOLD'];
  const level = levelMap[seatIndex % levelMap.length];

  if (level === 'SAFE') {
    return { level, guess: color };
  }
  if (level === 'MEDIUM') {
    return { level, guess: suit };
  }
  return { level, guess: secretCard };
}

async function writeSubmission(params: {
  workbookPath: string;
  sheetName: string;
  roundNumber: number;
  roundCode: string;
  level: SubmissionLevel;
  guess: string;
}): Promise<void> {
  const { workbookPath, sheetName, roundNumber, roundCode, level, guess } = params;
  const buffer = await fs.readFile(workbookPath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Missing worksheet ${sheetName}`);
  }

  ensureCell(sheet, 'A1', 'Round');
  ensureCell(sheet, 'B1', 'Color');
  ensureCell(sheet, 'C1', 'Suits');
  ensureCell(sheet, 'D1', 'Number');
  ensureCell(sheet, 'E1', 'Level');

  const decodedRange = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:E1');
  let targetRow = 0;
  for (let row = 2; row <= decodedRange.e.r + 1; row += 1) {
    const cell = sheet[`A${row}`];
    const parsed = Number(String(cell?.v ?? '').trim());
    if (Number.isFinite(parsed) && parsed === roundNumber) {
      targetRow = row;
      break;
    }
  }
  if (!targetRow) {
    targetRow = Math.max(2, decodedRange.e.r + 2);
  }

  const normalizedGuess = guess.toUpperCase();
  const parsedBoldGuess = level === 'BOLD' ? parseCardCode(normalizedGuess) : null;
  const color = level === 'SAFE' ? normalizedGuess : '';
  const suit = level === 'MEDIUM' ? normalizedGuess : parsedBoldGuess?.suit ?? '';
  const number = level === 'BOLD' ? rankToWorkbookValue(parsedBoldGuess?.rank ?? '') : '';

  ensureCell(sheet, `A${targetRow}`, roundNumber);
  ensureCell(sheet, `B${targetRow}`, color);
  ensureCell(sheet, `C${targetRow}`, suit);
  ensureCell(sheet, `D${targetRow}`, number);
  ensureCell(sheet, `E${targetRow}`, level);
  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(decodedRange.e.r, targetRow - 1), c: 4 }
  });

  const out = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  await fs.writeFile(workbookPath, out);
}

async function runRound(roundIndex: number, round: DemoRound, workbookPath: string): Promise<void> {
  await waitForPhase('SETUP', 15_000);
  log(`Round ${roundIndex + 1}: setting secret card ${round.secretCard}`);

  await requestJson('/api/game/setup/secret-card', {
    method: 'POST',
    body: JSON.stringify({ card: round.secretCard })
  });

  const setupState = await getState();
  if (setupState.config.insiderEnabled) {
    const reveal = await requestJson<{ insiderName: string; suit: string }>('/api/game/setup/pick-insider', {
      method: 'POST'
    });
    log(`Round ${roundIndex + 1}: insider=${reveal.insiderName}, suit=${reveal.suit}`);
  }

  await requestJson('/api/game/setup/start-investigation', { method: 'POST' });
  log(`Round ${roundIndex + 1}: investigation started`);

  for (const transcript of round.transcripts) {
    const state = await getState();
    if (state.phase !== 'INVESTIGATION') {
      break;
    }

    const outcome = await requestJson<{
      status: 'RESOLVED' | 'RETRY';
      transcript: string;
      editedQuestion: string | null;
      answer: 'YES' | 'NO' | null;
      reason: 'OK' | 'NO_VALID_QUESTION' | 'MODEL_REFUSED' | 'ERROR';
      latencyMs: number;
    }>('/api/game/investigation/analyze-question-text', {
      method: 'POST',
      body: JSON.stringify({ transcript })
    });

    log(
      `Round ${roundIndex + 1}: transcript="${transcript}" -> status=${outcome.status}, answer=${outcome.answer}, reason=${outcome.reason}, latency=${outcome.latencyMs}ms`
    );
    await sleep(700);
  }

  let state = await getState();
  if (state.phase === 'INVESTIGATION') {
    const currentTurnPlayer = state.players.find((player) => player.seatIndex === state.round.currentTurnSeatIndex);
    if (!currentTurnPlayer) {
      throw new Error('Missing current turn player while calling vault.');
    }

    await requestJson('/api/game/investigation/call-vault', {
      method: 'POST',
      body: JSON.stringify({ calledBy: currentTurnPlayer.id })
    });
    log(`Round ${roundIndex + 1}: ${currentTurnPlayer.name} called vault`);
  }

  state = await waitForPhase('SCORING', OPTIONS.investigationSeconds * 1000 + 30_000);
  log(`Round ${roundIndex + 1}: scoring with round code ${state.round.roundCode}`);

  const players = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
  for (const player of players) {
    const submission = buildSubmission(round.secretCard, player.seatIndex);
    await writeSubmission({
      workbookPath,
      sheetName: player.sheetName,
      roundNumber: state.round.roundNumber,
      roundCode: state.round.roundCode,
      level: submission.level,
      guess: submission.guess
    });
    log(
      `Round ${roundIndex + 1}: wrote submission for ${player.name} -> ${submission.level}/${submission.guess}`
    );
    await sleep(OPTIONS.submissionDelayMs);
  }

  await waitForPhase('REVEAL', OPTIONS.scoringSeconds * 1000 + 30_000);
  await requestJson('/api/game/reveal/next', { method: 'POST' });
  log(`Round ${roundIndex + 1}: reveal complete, next round requested`);
}

async function run(): Promise<void> {
  await requestJson<{ ok: true }>('/health');

  let state = await getState();
  if (state.phase !== 'LOBBY') {
    throw new Error(`Expected LOBBY phase. Current phase=${state.phase}`);
  }

  const workbookPath = await requireWorkbookPathFromEnv();
  log(`Workbook selected from ONE_DRIVE_XLSX_PATH: ${workbookPath}`);

  await removeAllPlayers(state);
  log(`Removed ${state.players.length} existing players`);

  const players: Array<{ name: string; team: TeamId }> = [
    { name: 'A-1', team: 'A' },
    { name: 'A-2', team: 'A' },
    { name: 'A-3', team: 'A' },
    { name: 'A-4', team: 'A' },
    { name: 'B-1', team: 'B' },
    { name: 'B-2', team: 'B' },
    { name: 'B-3', team: 'B' },
    { name: 'B-4', team: 'B' }
  ];

  for (const player of players) {
    await requestJson('/api/players', {
      method: 'POST',
      body: JSON.stringify(player)
    });
  }
  log('Added deterministic demo players');

  await requestJson('/api/config', {
    method: 'PUT',
    body: JSON.stringify({
      rounds: OPTIONS.rounds.length,
      investigationSeconds: OPTIONS.investigationSeconds,
      scoringSeconds: OPTIONS.scoringSeconds,
      pollIntervalMs: OPTIONS.pollIntervalMs
    })
  });
  log('Updated config for AI live gameplay demo');

  await requestJson('/api/preflight', {
    method: 'PUT',
    body: JSON.stringify({
      confirmedLocalAvailability: true,
      confirmedDesktopExcelClosed: true
    })
  });
  await requestJson('/api/workbook/initialize', { method: 'POST' });
  await requestJson('/api/game/start', { method: 'POST' });
  log('Game started');

  for (let index = 0; index < OPTIONS.rounds.length; index += 1) {
    await runRound(index, OPTIONS.rounds[index], workbookPath);
  }

  const finalState = await waitForPhase('DONE', 20_000);
  log(`AI live gameplay demo complete. Final score A=${finalState.teamScores.A}, B=${finalState.teamScores.B}`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[ai-live-demo] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
