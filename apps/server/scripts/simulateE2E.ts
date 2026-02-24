import fs from 'node:fs/promises';
import path from 'node:path';
import { GameStatePublic, TeamId } from '@chicken-vault/shared';
import * as XLSX from 'xlsx';
import { loadEnv } from '../src/utils/env.js';
import { parseCardCode, rankToWorkbookValue } from '../src/utils/cards.js';

loadEnv();

type SubmissionLevel = 'SAFE' | 'MEDIUM' | 'BOLD';
type QuestionAnswer = 'YES' | 'NO';

interface SimulationOptions {
  baseUrl: string;
  players: number;
  rounds: number;
  investigationSeconds?: number;
  turnSeconds: number;
  scoringSeconds: number;
  pollIntervalMs: number;
  submissionDelayMs: number;
}

const DEFAULT_OPTIONS: SimulationOptions = {
  baseUrl: 'http://localhost:4000',
  players: 8,
  rounds: 1,
  turnSeconds: 10,
  scoringSeconds: 25,
  pollIntervalMs: 1000,
  submissionDelayMs: 900
};

const NAME_POOL = [
  'Milo',
  'Nova',
  'Iris',
  'Rune',
  'Kian',
  'Luna',
  'Theo',
  'Zara',
  'Odin',
  'Maya',
  'Nia',
  'Ezra',
  'Ari',
  'Remy',
  'Cleo',
  'Jude',
  'Kai',
  'Sage',
  'Rhea',
  'Finn'
];

const QUESTION_POOL = [
  'Is it a face card?',
  'Is it a red card?',
  'Is the rank above 8?',
  'Is the suit a major symbol?',
  'Would you play this in a high hand?',
  'Is this card from a black suit?',
  'Can this card be considered a high rank?',
  'Is the suit heart or diamond?'
];

const SUITS = ['S', 'H', 'D', 'C'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;

function log(message: string): void {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  // eslint-disable-next-line no-console
  console.log(`[simulate ${ts}] ${message}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function randomItem<T>(items: T[]): T {
  return items[randomInt(items.length)];
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const tmp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = tmp;
  }
  return copy;
}

function parseArgs(argv: string[]): SimulationOptions {
  const options = { ...DEFAULT_OPTIONS };
  const pairs = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      pairs.set(key, 'true');
      continue;
    }
    pairs.set(key, next);
    index += 1;
  }

  const getNumber = (key: string, fallback: number): number => {
    const raw = pairs.get(key);
    if (!raw) {
      return fallback;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  if (pairs.has('workbook-path')) {
    throw new Error('--workbook-path is no longer supported. Set ONE_DRIVE_XLSX_PATH in .env.');
  }

  const baseUrl = pairs.get('base-url') ?? options.baseUrl;
  const investigationRaw = pairs.get('investigation-seconds');
  const parsedInvestigation =
    investigationRaw && Number.isFinite(Number(investigationRaw)) ? Number(investigationRaw) : undefined;

  return {
    baseUrl,
    players: Math.max(2, Math.floor(getNumber('players', options.players))),
    rounds: Math.max(1, Math.floor(getNumber('rounds', options.rounds))),
    investigationSeconds: parsedInvestigation ? Math.max(10, Math.floor(parsedInvestigation)) : undefined,
    turnSeconds: Math.max(0.5, getNumber('turn-seconds', options.turnSeconds)),
    scoringSeconds: Math.max(10, Math.floor(getNumber('scoring-seconds', options.scoringSeconds))),
    pollIntervalMs: Math.max(500, Math.floor(getNumber('poll-interval-ms', options.pollIntervalMs))),
    submissionDelayMs: Math.max(200, Math.floor(getNumber('submission-delay-ms', options.submissionDelayMs)))
  };
}

async function requestJson<T>(options: SimulationOptions, endpoint: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${options.baseUrl}${endpoint}`, {
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

async function getState(options: SimulationOptions): Promise<GameStatePublic> {
  return requestJson<GameStatePublic>(options, '/api/state');
}

async function putConfig(options: SimulationOptions, payload: Partial<GameStatePublic['config']>): Promise<void> {
  await requestJson<GameStatePublic>(options, '/api/config', {
    method: 'PUT',
    body: JSON.stringify(payload)
  });
}

async function setPreflight(options: SimulationOptions): Promise<void> {
  await requestJson<GameStatePublic>(options, '/api/preflight', {
    method: 'PUT',
    body: JSON.stringify({
      confirmedLocalAvailability: true,
      confirmedDesktopExcelClosed: true
    })
  });
}

async function removeAllPlayers(options: SimulationOptions, state: GameStatePublic): Promise<void> {
  for (const player of state.players) {
    await requestJson<void>(options, `/api/players/${player.id}`, { method: 'DELETE' });
  }
}

function pickNames(count: number): string[] {
  if (count <= NAME_POOL.length) {
    return shuffle(NAME_POOL).slice(0, count);
  }

  const names: string[] = [];
  const shuffled = shuffle(NAME_POOL);
  for (let index = 0; index < count; index += 1) {
    const base = shuffled[index % shuffled.length];
    const suffix = Math.floor(index / shuffled.length) + 1;
    names.push(`${base}_${suffix}`);
  }
  return names;
}

function buildTeamAssignments(count: number): TeamId[] {
  const teams: TeamId[] = [];
  const teamACount = Math.ceil(count / 2);
  for (let index = 0; index < count; index += 1) {
    teams.push(index < teamACount ? 'A' : 'B');
  }
  return shuffle(teams);
}

async function addRandomPlayers(options: SimulationOptions, count: number): Promise<void> {
  const names = pickNames(count);
  const teams = buildTeamAssignments(count);

  for (let index = 0; index < count; index += 1) {
    const payload = {
      name: names[index],
      team: teams[index]
    };
    await requestJson(options, '/api/players', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    log(`Added player seat ${index + 1}: ${payload.name} (${payload.team})`);
  }
}

function randomCardCode(): string {
  return `${RANKS[randomInt(RANKS.length)]}${SUITS[randomInt(SUITS.length)]}`;
}

function getColorFromSuit(suit: string): 'RED' | 'BLACK' {
  return suit === 'H' || suit === 'D' ? 'RED' : 'BLACK';
}

function randomDifferentSuit(suit: string): string {
  const choices = SUITS.filter((entry) => entry !== suit);
  return randomItem([...choices]);
}

function randomDifferentCard(secretCard: string): string {
  while (true) {
    const next = randomCardCode();
    if (next !== secretCard) {
      return next;
    }
  }
}

function randomSubmission(secretCard: string): { level: SubmissionLevel; guess: string } {
  const levelRoll = Math.random();
  const level: SubmissionLevel = levelRoll < 0.4 ? 'SAFE' : levelRoll < 0.75 ? 'MEDIUM' : 'BOLD';
  const suit = secretCard.slice(-1);
  const color = getColorFromSuit(suit);
  const isCorrect = Math.random() < 0.45;

  if (level === 'SAFE') {
    return {
      level,
      guess: isCorrect ? color : color === 'RED' ? 'BLACK' : 'RED'
    };
  }

  if (level === 'MEDIUM') {
    return {
      level,
      guess: isCorrect ? suit : randomDifferentSuit(suit)
    };
  }

  return {
    level,
    guess: isCorrect ? secretCard : randomDifferentCard(secretCard)
  };
}

function ensureCell(sheet: XLSX.WorkSheet, address: string, value: string | number): void {
  sheet[address] = {
    t: typeof value === 'number' ? 'n' : 's',
    v: value
  };
}

async function writePlayerSubmission(params: {
  workbookPath: string;
  sheetName: string;
  roundNumber: number;
  roundCode: string;
  level: SubmissionLevel;
  guess: string;
}): Promise<void> {
  const { workbookPath, sheetName, roundNumber, roundCode, level, guess } = params;

  let attempt = 0;
  let delayMs = 120;
  while (attempt < 5) {
    attempt += 1;
    try {
      const fileBuffer = await fs.readFile(workbookPath);
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
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

      const outBuffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx'
      });
      await fs.writeFile(workbookPath, outBuffer);
      return;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (attempt >= 5 || (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES')) {
        throw error;
      }
      await sleep(delayMs);
      delayMs *= 2;
    }
  }
}

async function waitForPhase(
  options: SimulationOptions,
  expected: GameStatePublic['phase'],
  timeoutMs: number
): Promise<GameStatePublic> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await getState(options);
    if (state.phase === expected) {
      return state;
    }
    await sleep(250);
  }
  const latest = await getState(options);
  throw new Error(`Timed out waiting for phase ${expected}. Current phase: ${latest.phase}`);
}

async function requireWorkbookPathFromEnv(): Promise<string> {
  const raw = process.env.ONE_DRIVE_XLSX_PATH?.trim() ?? '';
  if (!raw) {
    throw new Error('ONE_DRIVE_XLSX_PATH is required for simulation.');
  }
  const resolved = path.resolve(raw);
  await fs.stat(resolved);
  return resolved;
}

async function runInvestigationRound(
  options: SimulationOptions,
  expectedTurns: number
): Promise<void> {
  for (let turn = 0; turn < expectedTurns; turn += 1) {
    await sleep(options.turnSeconds * 1000);
    const state = await getState(options);
    if (state.phase !== 'INVESTIGATION') {
      return;
    }

    const currentPlayer = state.players.find((player) => player.seatIndex === state.round.currentTurnSeatIndex);
    if (!currentPlayer) {
      throw new Error(`No player found at seat ${state.round.currentTurnSeatIndex}`);
    }

    const question = randomItem(QUESTION_POOL);
    const answer: QuestionAnswer = Math.random() < 0.5 ? 'YES' : 'NO';

    await requestJson(options, '/api/game/investigation/resolve-question', {
      method: 'POST',
      body: JSON.stringify({ question, answer })
    });

    log(`${currentPlayer.name} asked "${question}" -> ${answer}`);
  }

  const state = await getState(options);
  if (state.phase !== 'INVESTIGATION') {
    return;
  }

  const caller = state.players.find((player) => player.seatIndex === state.round.currentTurnSeatIndex);
  if (!caller) {
    throw new Error('Unable to determine current turn player for call vault');
  }

  await requestJson(options, '/api/game/investigation/call-vault', {
    method: 'POST',
    body: JSON.stringify({ calledBy: caller.id })
  });
  log(`${caller.name} called vault`);
}

async function runScoringRound(
  options: SimulationOptions,
  state: GameStatePublic,
  workbookPath: string,
  secretCard: string
): Promise<void> {
  const players = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
  for (const player of players) {
    const submission = randomSubmission(secretCard);
    log(
      `Writing submission for ${player.name} (${player.sheetName}) -> level=${submission.level}, guess=${submission.guess}`
    );

    await writePlayerSubmission({
      workbookPath,
      sheetName: player.sheetName,
      roundNumber: state.round.roundNumber,
      roundCode: state.round.roundCode,
      level: submission.level,
      guess: submission.guess
    });

    log(`Released workbook after ${player.name} submission`);
    await sleep(options.submissionDelayMs + randomInt(700));
  }
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  log(
    `Starting E2E simulation: players=${options.players}, rounds=${options.rounds}, investigationSeconds=${options.investigationSeconds ?? 'auto'}, turnSeconds=${options.turnSeconds}, scoringSeconds=${options.scoringSeconds}, baseUrl=${options.baseUrl}`
  );

  await requestJson<{ ok: true }>(options, '/health');

  let state = await getState(options);
  if (state.phase !== 'LOBBY') {
    throw new Error(`Simulation requires LOBBY phase. Current phase is ${state.phase}. Restart server and retry.`);
  }

  const workbookPath = await requireWorkbookPathFromEnv();
  log(`Workbook path from ONE_DRIVE_XLSX_PATH: ${workbookPath}`);
  await removeAllPlayers(options, state);
  log(`Cleared existing players (${state.players.length})`);

  await addRandomPlayers(options, options.players);
  state = await getState(options);

  const investigationSeconds =
    options.investigationSeconds ?? Math.max(10, Math.floor(options.turnSeconds * state.players.length));
  await putConfig(options, {
    rounds: options.rounds,
    investigationSeconds,
    scoringSeconds: options.scoringSeconds,
    pollIntervalMs: options.pollIntervalMs
  });
  log(
    `Updated config -> rounds=${options.rounds}, investigationSeconds=${investigationSeconds}, scoringSeconds=${options.scoringSeconds}, pollIntervalMs=${options.pollIntervalMs}`
  );

  await setPreflight(options);
  log('Preflight confirmed');

  await requestJson(options, '/api/workbook/initialize', { method: 'POST' });
  log(`Workbook initialized at ${workbookPath}`);

  await requestJson(options, '/api/game/start', { method: 'POST' });
  log('Game started');

  for (let roundIndex = 0; roundIndex < options.rounds; roundIndex += 1) {
    state = await waitForPhase(options, 'SETUP', 10_000);
    const roundNo = state.round.roundNumber;
    const secretCard = randomCardCode();
    log(`Round ${roundNo}: secret card set to ${secretCard}`);

    await requestJson(options, '/api/game/setup/secret-card', {
      method: 'POST',
      body: JSON.stringify({ card: secretCard })
    });

    if (state.config.insiderEnabled) {
      const reveal = await requestJson<{ insiderName: string; suit: string }>(options, '/api/game/setup/pick-insider', {
        method: 'POST'
      });
      log(`Round ${roundNo}: insider picked -> ${reveal.insiderName}, suit hint ${reveal.suit}`);
    }

    await requestJson(options, '/api/game/setup/start-investigation', {
      method: 'POST'
    });
    log(`Round ${roundNo}: investigation started`);

    await runInvestigationRound(options, state.players.length);

    state = await waitForPhase(options, 'SCORING', investigationSeconds * 1000 + 30_000);
    log(`Round ${roundNo}: scoring started with code ${state.round.roundCode}`);

    await runScoringRound(options, state, workbookPath, secretCard);

    state = await waitForPhase(options, 'REVEAL', options.scoringSeconds * 1000 + 30_000);
    log(`Round ${roundNo}: reveal ready -> round totals A=${state.history.at(-1)?.teamRoundTotals.A ?? 0}, B=${state.history.at(-1)?.teamRoundTotals.B ?? 0}`);

    await requestJson(options, '/api/game/reveal/next', {
      method: 'POST'
    });
    log(`Round ${roundNo}: next clicked`);
  }

  state = await waitForPhase(options, 'DONE', 10_000);
  log(`Simulation complete. Final score A=${state.teamScores.A}, B=${state.teamScores.B}`);
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[simulate] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
