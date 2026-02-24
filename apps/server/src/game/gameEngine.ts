import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  AiQuestionOutcome,
  DemoState,
  GameConfig,
  GamePhase,
  GameStatePublic,
  HostPreflightState,
  InsiderRevealPayload,
  Player,
  QuestionAnswer,
  RoundResultRow,
  RoundStatePublic,
  RoundSummary,
  Submission,
  SubmissionLevel,
  TeamId,
  TeamTotals,
  ToastEvent,
  WorkbookAlert
} from '@chicken-vault/shared';
import {
  decideQuestionFromTranscript,
  resolveAiConfigFromEnv,
  transcribeQuestionAudio
} from '../ai/questionAnalyzer.js';
import {
  detectWorkbookAlerts,
  initializeWorkbookForPlayers,
  invalidSubmissionAlert,
  lockAlert,
  parseRetryAlert,
  prepareScoringRound,
  readWorkbookSnapshot,
  writeAcknowledgements
} from './workbookService.js';
import {
  calculateGuessPoints,
  composeBoldGuess,
  isSubmissionLevel,
  normalizeGuess,
  parseCardCode,
  rankToWorkbookValue,
  validateGuess
} from '../utils/cards.js';
import { findPlayerBySeatIndex, sortPlayersBySeat } from '../utils/sheets.js';
import { nowIso, wait } from '../utils/time.js';
import * as XLSX from 'xlsx';

interface RoundPrivateFields {
  secretCard: string | null;
  insiderId: string | null;
}

interface EngineState {
  phase: GamePhase;
  config: GameConfig;
  preflight: HostPreflightState;
  players: Player[];
  round: RoundStatePublic;
  roundPrivate: RoundPrivateFields;
  teamScores: TeamTotals;
  history: RoundSummary[];
  workbookInitialized: boolean;
  workbook: {
    activePath: string;
    lastMtimeMs: number | null;
    alerts: WorkbookAlert[];
  };
  demo: DemoState;
  lastActions: Record<string, string>;
}

interface EngineEvents {
  onState: (state: GameStatePublic) => void;
  onToast: (toast: ToastEvent) => void;
}

const ROUND_CODE_WORDS = [
  'KITE',
  'SPARK',
  'LIME',
  'ECHO',
  'PRISM',
  'EMBER',
  'NOVA',
  'FROST',
  'RIVER',
  'BLAZE'
];

const DEMO_CONFIG = {
  rounds: 1,
  investigationSeconds: 40,
  scoringSeconds: 20,
  pollIntervalMs: 1000,
  submissionDelayMs: 1300
};

const DEMO_QUESTIONS = [
  'Is it a face card?',
  'Is it a red card?',
  'Is the rank above 8?',
  'Is the suit a major symbol?',
  'Would you play this in a high hand?',
  'Is this card from a black suit?',
  'Can this card be considered a high rank?',
  'Is the suit heart or diamond?'
];

const DEMO_SUITS = ['S', 'H', 'D', 'C'] as const;
const DEMO_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveWorkbookPathFromEnv(): string {
  const raw = process.env.ONE_DRIVE_XLSX_PATH?.trim() ?? '';
  if (!raw) {
    throw new Error('Workbook path is env-locked. Set ONE_DRIVE_XLSX_PATH in .env.');
  }

  const resolved = path.resolve(raw);
  if (!existsSync(resolved)) {
    throw new Error(`Workbook file not found at ONE_DRIVE_XLSX_PATH: ${resolved}`);
  }

  return resolved;
}

function blankRoundState(): RoundStatePublic {
  return {
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
  };
}

function blankTotals(): TeamTotals {
  return { A: 0, B: 0 };
}

export function computeDealerSeatIndex(startingDealerSeatIndex: number, roundNumber: number, playerCount: number): number {
  if (playerCount <= 0) {
    return 0;
  }
  return (startingDealerSeatIndex + (roundNumber - 1)) % playerCount;
}

export function computeSeatAfter(seatIndex: number, playerCount: number): number {
  if (playerCount <= 0) {
    return 0;
  }
  return (seatIndex + 1) % playerCount;
}

export class GameEngine {
  private state: EngineState;

  private readonly events: EngineEvents;

  private investigationTimer: NodeJS.Timeout | null = null;

  private scoringTimer: NodeJS.Timeout | null = null;

  private scoringPollTimer: NodeJS.Timeout | null = null;

  private scoringFinalizing = false;

  private demoTask: Promise<void> | null = null;

  constructor(events: EngineEvents) {
    this.events = events;
    const workbookPath = resolveWorkbookPathFromEnv();

    const defaultConfig: GameConfig = {
      rounds: 3,
      investigationSeconds: 180,
      scoringSeconds: 60,
      vaultStart: 4,
      insiderEnabled: true,
      pollIntervalMs: 2000,
      excelPath: workbookPath,
      excelShareUrl: '',
      ackWritesEnabled: process.env.ACK_WRITES_ENABLED === 'true',
      startingDealerSeatIndex: 0
    };

    this.state = {
      phase: 'LOBBY',
      config: defaultConfig,
      preflight: {
        confirmedLocalAvailability: true,
        confirmedDesktopExcelClosed: true,
        preflightPassed: true
      },
      players: [],
      round: blankRoundState(),
      roundPrivate: {
        secretCard: null,
        insiderId: null
      },
      teamScores: blankTotals(),
      history: [],
      workbookInitialized: false,
      workbook: {
        activePath: defaultConfig.excelPath,
        lastMtimeMs: null,
        alerts: []
      },
      demo: {
        status: 'IDLE',
        targetDurationSeconds: 60
      },
      lastActions: {}
    };
  }

  getPublicState(): GameStatePublic {
    return {
      phase: this.state.phase,
      config: this.state.config,
      preflight: this.state.preflight,
      players: sortPlayersBySeat(this.state.players),
      round: this.state.round,
      teamScores: this.state.teamScores,
      history: this.state.history,
      workbook: this.state.workbook,
      demo: this.state.demo,
      lastActions: this.state.lastActions
    };
  }

  close(): void {
    this.clearInvestigationTimer();
    this.clearScoringTimers();
  }

  private emitState(): void {
    this.events.onState(this.getPublicState());
  }

  private pushToast(message: string, level: ToastEvent['level'] = 'info'): void {
    this.events.onToast({
      id: crypto.randomUUID(),
      message,
      level,
      ts: nowIso()
    });
  }

  private setAlerts(alerts: WorkbookAlert[]): void {
    this.state.workbook.alerts = alerts;
  }

  private addAlert(alert: WorkbookAlert): void {
    const withoutSameId = this.state.workbook.alerts.filter((entry) => entry.id !== alert.id);
    this.state.workbook.alerts = [alert, ...withoutSameId].slice(0, 20);
  }

  private clearInvestigationTimer(): void {
    if (this.investigationTimer) {
      clearTimeout(this.investigationTimer);
      this.investigationTimer = null;
    }
  }

  private clearScoringTimers(): void {
    if (this.scoringTimer) {
      clearTimeout(this.scoringTimer);
      this.scoringTimer = null;
    }
    if (this.scoringPollTimer) {
      clearInterval(this.scoringPollTimer);
      this.scoringPollTimer = null;
    }
  }

  private ensureLobbyEditable(): void {
    if (this.state.phase !== 'LOBBY') {
      throw new Error('Lobby controls are only available in LOBBY phase.');
    }
    if (this.state.demo.status === 'RUNNING') {
      throw new Error('Lobby controls are locked while demo is running.');
    }
  }

  private requirePlayers(min = 2): void {
    if (this.state.players.length < min) {
      throw new Error(`At least ${min} players are required.`);
    }
  }

  private getPlayerById(playerId: string): Player {
    const player = this.state.players.find((entry) => entry.id === playerId);
    if (!player) {
      throw new Error('Player not found.');
    }
    return player;
  }

  private getPlayerAtSeat(seatIndex: number): Player {
    const player = findPlayerBySeatIndex(this.state.players, seatIndex);
    if (!player) {
      throw new Error(`No player in seat ${seatIndex}.`);
    }
    return player;
  }

  private beginMatch(message: string): void {
    this.state.phase = 'SETUP';
    this.state.teamScores = blankTotals();
    this.state.history = [];
    this.resetRoundState(1);

    this.pushToast(message, 'success');
    this.emitState();
  }

  private resetRoundState(roundNumber: number): void {
    this.requirePlayers();
    const playerCount = this.state.players.length;
    const previousDealerSeatIndex = this.state.round.roundNumber > 0 ? this.state.round.dealerSeatIndex : null;
    const dealerSeatIndex = this.randomDealerPosition(previousDealerSeatIndex, playerCount);

    const tracker: RoundStatePublic['submissionTracker'] = {};
    for (const player of this.state.players) {
      tracker[player.id] = {
        submitted: false,
        lastSeenAt: null,
        validationMessage: null
      };
    }

    this.state.round = {
      roundNumber,
      dealerSeatIndex,
      currentTurnSeatIndex: computeSeatAfter(dealerSeatIndex, playerCount),
      dealerId: null,
      vaultValue: this.state.config.vaultStart,
      calledBy: null,
      questions: [],
      roundCode: '',
      investigationEndsAt: null,
      scoringEndsAt: null,
      submissions: {},
      submissionTracker: tracker,
      latestResult: null
    };
    this.state.roundPrivate = {
      secretCard: null,
      insiderId: null
    };
    this.state.lastActions = {};
  }

  private generateRoundCode(roundNumber: number): string {
    const token = ROUND_CODE_WORDS[Math.floor(Math.random() * ROUND_CODE_WORDS.length)];
    return `R${roundNumber}-${token}`;
  }

  private randomInt(maxExclusive: number): number {
    return Math.floor(Math.random() * maxExclusive);
  }

  private randomItem<T>(items: T[]): T {
    return items[this.randomInt(items.length)];
  }

  private randomCardCode(): string {
    const rank = DEMO_RANKS[this.randomInt(DEMO_RANKS.length)];
    const suit = DEMO_SUITS[this.randomInt(DEMO_SUITS.length)];
    return `${rank}${suit}`;
  }

  private getColorFromSuit(suit: string): 'RED' | 'BLACK' {
    return suit === 'H' || suit === 'D' ? 'RED' : 'BLACK';
  }

  private randomDifferentSuit(suit: string): string {
    const choices = DEMO_SUITS.filter((entry) => entry !== suit);
    return this.randomItem([...choices]);
  }

  private randomDifferentCard(secretCard: string): string {
    while (true) {
      const candidate = this.randomCardCode();
      if (candidate !== secretCard) {
        return candidate;
      }
    }
  }

  private randomDealerPosition(previousSeatIndex: number | null, playerCount: number): number {
    if (playerCount <= 1) {
      return 0;
    }

    let seatIndex = this.randomInt(playerCount);
    while (previousSeatIndex !== null && seatIndex === previousSeatIndex) {
      seatIndex = this.randomInt(playerCount);
    }
    return seatIndex;
  }

  private randomDemoSubmission(secretCard: string): { level: SubmissionLevel; guess: string } {
    const levelRoll = Math.random();
    const level: SubmissionLevel = levelRoll < 0.4 ? 'SAFE' : levelRoll < 0.75 ? 'MEDIUM' : 'BOLD';
    const suit = secretCard.slice(-1);
    const color = this.getColorFromSuit(suit);
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
        guess: isCorrect ? suit : this.randomDifferentSuit(suit)
      };
    }

    return {
      level,
      guess: isCorrect ? secretCard : this.randomDifferentCard(secretCard)
    };
  }

  private async waitForPhase(phase: GamePhase, timeoutMs: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (this.state.phase === phase) {
        return;
      }
      await wait(150);
    }
    throw new Error(`Timed out waiting for phase ${phase}. Current phase is ${this.state.phase}.`);
  }

  private async syncWorkbookForCurrentPlayers(): Promise<void> {
    const updatedPlayers = await initializeWorkbookForPlayers({
      workbookPath: this.state.config.excelPath,
      players: this.state.players
    });
    this.state.players = sortPlayersBySeat(updatedPlayers);
    this.state.workbookInitialized = true;
    this.setAlerts([]);
  }

  private ensureWorkbookConfigured(): void {
    const resolvedPath = resolveWorkbookPathFromEnv();
    this.state.config.excelPath = resolvedPath;
    this.state.config.excelShareUrl = '';
    this.state.workbook.activePath = resolvedPath;
  }

  addPlayer(input: { name: string; team: TeamId }): Player {
    this.ensureLobbyEditable();
    const name = input.name.trim();
    if (!name) {
      throw new Error('Player name is required.');
    }
    const seatIndex = this.state.players.length;
    const player: Player = {
      id: crypto.randomUUID(),
      name,
      team: input.team,
      seatIndex,
      sheetName: ''
    };
    this.state.players.push(player);
    this.emitState();
    return player;
  }

  updatePlayer(playerId: string, updates: { name?: string; team?: TeamId }): void {
    this.ensureLobbyEditable();
    const player = this.getPlayerById(playerId);
    if (updates.name !== undefined) {
      const trimmed = updates.name.trim();
      if (!trimmed) {
        throw new Error('Player name cannot be empty.');
      }
      player.name = trimmed;
    }
    if (updates.team !== undefined) {
      player.team = updates.team;
    }
    this.emitState();
  }

  removePlayer(playerId: string): void {
    this.ensureLobbyEditable();
    this.state.players = this.state.players.filter((player) => player.id !== playerId);
    const sorted = sortPlayersBySeat(this.state.players);
    sorted.forEach((player, index) => {
      player.seatIndex = index;
    });
    this.state.players = sorted;
    this.emitState();
  }

  reorderPlayers(playerIdsInSeatOrder: string[]): void {
    this.ensureLobbyEditable();
    if (playerIdsInSeatOrder.length !== this.state.players.length) {
      throw new Error('Reorder list does not match player count.');
    }

    const unique = new Set(playerIdsInSeatOrder);
    if (unique.size !== this.state.players.length) {
      throw new Error('Reorder list contains duplicates.');
    }

    const byId = new Map(this.state.players.map((player) => [player.id, player]));
    const next: Player[] = [];

    for (let index = 0; index < playerIdsInSeatOrder.length; index += 1) {
      const id = playerIdsInSeatOrder[index];
      const player = byId.get(id);
      if (!player) {
        throw new Error('Reorder list contains unknown player.');
      }
      next.push({
        ...player,
        seatIndex: index
      });
    }

    this.state.players = next;
    this.emitState();
  }

  updateConfig(partial: Partial<GameConfig>): void {
    this.ensureLobbyEditable();

    if (partial.excelPath !== undefined || partial.excelShareUrl !== undefined) {
      throw new Error('Workbook path is env-locked; set ONE_DRIVE_XLSX_PATH in .env.');
    }

    const next: GameConfig = {
      ...this.state.config,
      ...partial
    };

    next.rounds = clamp(Math.floor(next.rounds), 1, 10);
    next.investigationSeconds = clamp(Math.floor(next.investigationSeconds), 10, 900);
    next.scoringSeconds = clamp(Math.floor(next.scoringSeconds), 10, 600);
    next.vaultStart = clamp(Math.floor(next.vaultStart), 1, 99);
    next.pollIntervalMs = clamp(Math.floor(next.pollIntervalMs), 1000, 10000);
    next.startingDealerSeatIndex = 0;
    next.excelPath = resolveWorkbookPathFromEnv();
    next.excelShareUrl = '';

    this.state.config = next;
    this.state.workbook.activePath = next.excelPath;
    this.emitState();
  }

  setPreflight(next: { confirmedLocalAvailability: boolean; confirmedDesktopExcelClosed: boolean }): void {
    this.state.preflight = {
      ...next,
      preflightPassed: next.confirmedLocalAvailability && next.confirmedDesktopExcelClosed
    };
    this.emitState();
  }

  async initializeWorkbook(): Promise<void> {
    this.ensureLobbyEditable();
    if (!this.state.preflight.preflightPassed) {
      throw new Error('Preflight is required before workbook initialization.');
    }
    this.requirePlayers();
    this.ensureWorkbookConfigured();

    try {
      await this.syncWorkbookForCurrentPlayers();
      this.pushToast('Workbook initialized successfully.', 'success');
      this.emitState();
    } catch (error) {
      this.addAlert(lockAlert());
      this.emitState();
      throw error;
    }
  }

  async startGame(): Promise<void> {
    this.ensureLobbyEditable();
    this.requirePlayers();
    if (!this.state.preflight.preflightPassed) {
      throw new Error('Preflight confirmations are required before starting the game.');
    }
    this.ensureWorkbookConfigured();

    if (!this.state.workbookInitialized) {
      try {
        await this.syncWorkbookForCurrentPlayers();
      } catch (error) {
        this.addAlert(lockAlert());
        this.emitState();
        throw error;
      }
    }

    this.state.demo.status = 'IDLE';
    this.beginMatch('Game started. In SETUP, start investigation to auto-select card and insider.');
  }

  resetGameToLobby(): void {
    this.clearInvestigationTimer();
    this.clearScoringTimers();
    this.scoringFinalizing = false;

    this.state.phase = 'LOBBY';
    this.state.round = blankRoundState();
    this.state.roundPrivate = {
      secretCard: null,
      insiderId: null
    };
    this.state.teamScores = blankTotals();
    this.state.history = [];
    this.state.lastActions = {};
    this.state.demo.status = 'IDLE';

    this.pushToast('Game reset to lobby.', 'warning');
    this.emitState();
  }

  async startRealGameAfterDemo(): Promise<void> {
    if (this.state.phase !== 'DONE') {
      throw new Error('Real game start is only available after demo/game ends (DONE phase).');
    }

    this.requirePlayers();
    if (!this.state.preflight.preflightPassed) {
      throw new Error('Preflight confirmations are required before starting the real game.');
    }
    this.ensureWorkbookConfigured();

    this.clearInvestigationTimer();
    this.clearScoringTimers();

    try {
      await this.syncWorkbookForCurrentPlayers();
    } catch (error) {
      this.addAlert(lockAlert());
      this.emitState();
      throw error;
    }

    this.state.demo.status = 'IDLE';
    this.beginMatch('Real game started. In SETUP, start investigation to auto-select card and insider.');
  }

  startDemo(): void {
    this.ensureLobbyEditable();
    if (this.demoTask || this.state.demo.status === 'RUNNING') {
      throw new Error('Demo is already running.');
    }
    if (!this.state.preflight.preflightPassed) {
      throw new Error('Preflight confirmations are required before demo.');
    }
    this.requirePlayers();
    this.ensureWorkbookConfigured();

    const originalConfig: GameConfig = { ...this.state.config };
    this.state.demo.status = 'RUNNING';
    this.emitState();

    this.demoTask = this.runDemoFlow(originalConfig)
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'Unexpected demo failure';
        this.pushToast(`Demo failed: ${message}`, 'error');
        this.state.demo.status = 'IDLE';
        this.emitState();
      })
      .finally(() => {
        this.demoTask = null;
      });
  }

  private async runDemoFlow(originalConfig: GameConfig): Promise<void> {
    try {
      await this.syncWorkbookForCurrentPlayers();

      this.state.config = {
        ...this.state.config,
        rounds: DEMO_CONFIG.rounds,
        investigationSeconds: DEMO_CONFIG.investigationSeconds,
        scoringSeconds: DEMO_CONFIG.scoringSeconds,
        pollIntervalMs: DEMO_CONFIG.pollIntervalMs
      };
      this.state.workbook.activePath = this.state.config.excelPath;

      this.beginMatch('Demo started. Watch the flow, timing, and scoring.');

      const secretCard = this.randomCardCode();
      this.setSecretCard(secretCard);
      if (this.state.config.insiderEnabled) {
        this.pickInsider();
      }
      this.startInvestigation();

      await this.runDemoInvestigation();
      await this.waitForPhase('SCORING', this.state.config.investigationSeconds * 1000 + 7000);
      await this.runDemoScoring(secretCard);
      await this.waitForPhase('REVEAL', this.state.config.scoringSeconds * 1000 + 10000);

      this.nextRound();
      this.state.demo.status = 'READY_TO_START';
      this.pushToast('Demo complete. Press START REAL GAME when ready.', 'success');
    } finally {
      this.state.config = {
        ...originalConfig,
        excelPath: this.state.config.excelPath
      };
      this.state.workbook.activePath = this.state.config.excelPath;
      this.emitState();
    }
  }

  private async runDemoInvestigation(): Promise<void> {
    const turns = Math.max(2, Math.min(this.state.players.length, 8));
    const pauseMs = Math.max(1800, Math.floor((this.state.config.investigationSeconds * 1000) / (turns + 1)));

    for (let turn = 0; turn < turns; turn += 1) {
      await wait(pauseMs);
      if (this.state.phase !== 'INVESTIGATION') {
        return;
      }

      this.resolveQuestion({
        question: this.randomItem(DEMO_QUESTIONS),
        answer: this.randomInt(2) === 0 ? 'YES' : 'NO'
      });
    }

    if (this.state.phase !== 'INVESTIGATION') {
      return;
    }

    await wait(600);
    if (this.state.phase !== 'INVESTIGATION') {
      return;
    }

    const caller = this.getPlayerAtSeat(this.state.round.currentTurnSeatIndex);
    await this.callVault(caller.id);
  }

  private async runDemoScoring(secretCard: string): Promise<void> {
    const players = sortPlayersBySeat(this.state.players);
    for (const player of players) {
      if (this.state.phase !== 'SCORING') {
        return;
      }

      const submission = this.randomDemoSubmission(secretCard);
      await this.writeDemoSubmissionToWorkbook({
        player,
        level: submission.level,
        guess: submission.guess
      });

      await wait(DEMO_CONFIG.submissionDelayMs + this.randomInt(500));
    }
  }

  private async writeDemoSubmissionToWorkbook(params: {
    player: Player;
    level: SubmissionLevel;
    guess: string;
  }): Promise<void> {
    const { player, level, guess } = params;

    let attempt = 0;
    let delayMs = 150;

    while (attempt < 5) {
      attempt += 1;
      try {
        const fileBuffer = await fs.readFile(this.state.config.excelPath);
        const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
        const sheet = workbook.Sheets[player.sheetName];

        if (!sheet) {
          throw new Error(`Missing worksheet ${player.sheetName}`);
        }

        sheet.A1 = { t: 's', v: 'Round' };
        sheet.B1 = { t: 's', v: 'Color' };
        sheet.C1 = { t: 's', v: 'Suits' };
        sheet.D1 = { t: 's', v: 'Number' };
        sheet.E1 = { t: 's', v: 'Level' };

        const decodedRange = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:E1');
        let targetRow = 0;
        for (let row = 2; row <= decodedRange.e.r + 1; row += 1) {
          const cell = sheet[`A${row}`];
          const parsed = Number(String(cell?.v ?? '').trim());
          if (Number.isFinite(parsed) && parsed === this.state.round.roundNumber) {
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

        sheet[`A${targetRow}`] = { t: 'n', v: this.state.round.roundNumber };
        sheet[`B${targetRow}`] = { t: 's', v: color };
        sheet[`C${targetRow}`] = { t: 's', v: suit };
        sheet[`D${targetRow}`] = { t: 's', v: number };
        sheet[`E${targetRow}`] = { t: 's', v: level };
        sheet['!ref'] = XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: Math.max(decodedRange.e.r, targetRow - 1), c: 4 }
        });

        const outBuffer = XLSX.write(workbook, {
          type: 'buffer',
          bookType: 'xlsx'
        });

        await fs.writeFile(this.state.config.excelPath, outBuffer);
        return;
      } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (attempt >= 5 || (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES')) {
          throw error;
        }
        await wait(delayMs);
        delayMs *= 2;
      }
    }
  }

  setSecretCard(secretCard: string): void {
    if (this.state.phase !== 'SETUP') {
      throw new Error('Secret card can only be set during SETUP.');
    }
    const normalized = secretCard.trim().toUpperCase();
    if (!parseCardCode(normalized)) {
      throw new Error('Invalid card code. Use Rank+Suit (e.g., QD).');
    }
    this.state.roundPrivate.secretCard = normalized;
    // eslint-disable-next-line no-console
    console.log(`[HOST] Round ${this.state.round.roundNumber} secret card selected: ${normalized}`);
    this.pushToast('Secret card stored for this round.', 'success');
    this.emitState();
  }

  pickInsider(): InsiderRevealPayload {
    if (this.state.phase !== 'SETUP') {
      throw new Error('Insider can only be picked during SETUP.');
    }
    if (!this.state.config.insiderEnabled) {
      throw new Error('Insider twist is disabled.');
    }
    if (!this.state.roundPrivate.secretCard) {
      throw new Error('Set secret card before picking insider.');
    }
    if (this.state.roundPrivate.insiderId) {
      throw new Error('Insider already selected for this round.');
    }

    const randomPlayer = this.state.players[Math.floor(Math.random() * this.state.players.length)];
    this.state.roundPrivate.insiderId = randomPlayer.id;

    const parsed = parseCardCode(this.state.roundPrivate.secretCard);
    if (!parsed) {
      throw new Error('Secret card is invalid.');
    }

    // eslint-disable-next-line no-console
    console.log(
      `[HOST] Round ${this.state.round.roundNumber} insider selected: ${randomPlayer.name} (suit hint ${parsed.suit})`
    );
    this.pushToast('Insider selected for this round.', 'info');
    this.emitState();

    return {
      insiderName: randomPlayer.name,
      suit: parsed.suit
    };
  }

  startInvestigation(): void {
    if (this.state.phase !== 'SETUP') {
      throw new Error('Investigation can only start from SETUP.');
    }

    if (!this.state.roundPrivate.secretCard) {
      const secretCard = this.randomCardCode();
      this.state.roundPrivate.secretCard = secretCard;
      // eslint-disable-next-line no-console
      console.log(`[HOST] Round ${this.state.round.roundNumber} secret card selected: ${secretCard}`);
      this.pushToast('Secret card selected automatically for this round.', 'info');
    }

    if (this.state.config.insiderEnabled && !this.state.roundPrivate.insiderId) {
      const randomPlayer = this.state.players[Math.floor(Math.random() * this.state.players.length)];
      this.state.roundPrivate.insiderId = randomPlayer.id;

      const parsed = parseCardCode(this.state.roundPrivate.secretCard);
      if (!parsed) {
        throw new Error('Secret card is invalid.');
      }

      // eslint-disable-next-line no-console
      console.log(
        `[HOST] Round ${this.state.round.roundNumber} insider selected: ${randomPlayer.name} (suit hint ${parsed.suit})`
      );
      this.pushToast('Insider selected automatically for this round.', 'info');
    }

    const playerCount = this.state.players.length;
    this.state.phase = 'INVESTIGATION';
    this.state.round.currentTurnSeatIndex = computeSeatAfter(this.state.round.dealerSeatIndex, playerCount);
    this.state.round.investigationEndsAt = Date.now() + this.state.config.investigationSeconds * 1000;

    this.clearInvestigationTimer();
    this.investigationTimer = setTimeout(() => {
      void this.callVault('AUTO');
    }, this.state.config.investigationSeconds * 1000);

    const firstPlayer = this.getPlayerAtSeat(this.state.round.currentTurnSeatIndex);
    this.pushToast(`It's ${firstPlayer.name}'s turn.`, 'info');
    this.emitState();
  }

  resolveQuestion(input: { question: string; answer: QuestionAnswer }): void {
    if (this.state.phase !== 'INVESTIGATION') {
      throw new Error('Questions can only be resolved during INVESTIGATION.');
    }

    const question = input.question.trim();
    if (!question) {
      throw new Error('Question text is required.');
    }

    const currentPlayer = this.getPlayerAtSeat(this.state.round.currentTurnSeatIndex);
    this.state.round.questions.push({
      askerPlayerId: currentPlayer.id,
      question,
      answer: input.answer,
      ts: nowIso()
    });
    this.state.round.vaultValue += 1;
    this.state.lastActions[currentPlayer.id] = 'asked Q';

    const nextSeat = computeSeatAfter(this.state.round.currentTurnSeatIndex, this.state.players.length);
    this.state.round.currentTurnSeatIndex = nextSeat;

    const nextPlayer = this.getPlayerAtSeat(nextSeat);
    this.pushToast(`It's ${nextPlayer.name}'s turn.`, 'info');
    this.emitState();
  }

  private ensureAiAnalysisReady(): string {
    if (this.state.phase !== 'INVESTIGATION') {
      throw new Error('AI question analysis is only available during INVESTIGATION.');
    }
    if (!this.state.roundPrivate.secretCard) {
      throw new Error('Secret card is required before AI question analysis.');
    }
    return this.state.roundPrivate.secretCard;
  }

  private toRetryOutcome(params: {
    transcript: string;
    reason: AiQuestionOutcome['reason'];
    startedAt: number;
  }): AiQuestionOutcome {
    return {
      status: 'RETRY',
      transcript: params.transcript,
      editedQuestion: null,
      answer: null,
      reason: params.reason,
      latencyMs: Date.now() - params.startedAt
    };
  }

  private applyAiDecision(params: {
    transcript: string;
    editedQuestion: string;
    answer: QuestionAnswer | null;
    shouldRespond: boolean;
    modelRefused?: boolean;
    startedAt: number;
  }): AiQuestionOutcome {
    const { transcript, editedQuestion, answer, shouldRespond, modelRefused, startedAt } = params;

    if (!shouldRespond) {
      if (modelRefused) {
        this.pushToast('AI model refused this question. Ask again.', 'warning');
      } else {
        this.pushToast('No clear player question detected. Ask again.', 'warning');
      }
      return this.toRetryOutcome({
        transcript,
        reason: modelRefused ? 'MODEL_REFUSED' : 'NO_VALID_QUESTION',
        startedAt
      });
    }

    const cleaned = editedQuestion.trim();
    if (!cleaned || !answer) {
      this.pushToast('Question was unclear. Ask again.', 'warning');
      return this.toRetryOutcome({
        transcript,
        reason: 'NO_VALID_QUESTION',
        startedAt
      });
    }

    this.resolveQuestion({
      question: cleaned,
      answer
    });

    return {
      status: 'RESOLVED',
      transcript,
      editedQuestion: cleaned,
      answer,
      reason: 'OK',
      latencyMs: Date.now() - startedAt
    };
  }

  async analyzeAndResolveFromTranscript(transcriptRaw: string): Promise<AiQuestionOutcome> {
    const startedAt = Date.now();
    const transcript = transcriptRaw.trim();
    // eslint-disable-next-line no-console
    console.log(`[HOST] Transcript received: ${transcript || '<empty>'}`);

    const secretCard = this.ensureAiAnalysisReady();
    if (!transcript) {
      this.pushToast('No clear player question detected. Ask again.', 'warning');
      return this.toRetryOutcome({
        transcript: '',
        reason: 'NO_VALID_QUESTION',
        startedAt
      });
    }

    try {
      const decision = await decideQuestionFromTranscript({
        transcript,
        secretCard,
        config: resolveAiConfigFromEnv()
      });

      return this.applyAiDecision({
        transcript,
        editedQuestion: decision.editedQuestion,
        answer: decision.answer,
        shouldRespond: decision.shouldRespond,
        modelRefused: decision.modelRefused,
        startedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown AI analysis error.';
      // eslint-disable-next-line no-console
      console.error('[HOST] Transcript analysis error:', error);
      this.pushToast(`AI analysis failed: ${message}`, 'error');
      return this.toRetryOutcome({
        transcript,
        reason: 'ERROR',
        startedAt
      });
    }
  }

  async analyzeAndResolveFromAudio(params: { audioBuffer: Buffer; mimeType: string }): Promise<AiQuestionOutcome> {
    const startedAt = Date.now();
    const secretCard = this.ensureAiAnalysisReady();
    const config = resolveAiConfigFromEnv();
    // eslint-disable-next-line no-console
    console.log(`[HOST] Audio payload: ${params.mimeType || 'unknown'} (${params.audioBuffer.length} bytes)`);

    try {
      const transcript = await transcribeQuestionAudio({
        audioBuffer: params.audioBuffer,
        mimeType: params.mimeType,
        config
      });
      // eslint-disable-next-line no-console
      console.log(`[HOST] Transcribed question: ${transcript || '<empty>'}`);

      if (!transcript.trim()) {
        this.pushToast('No clear player question detected. Ask again.', 'warning');
        return this.toRetryOutcome({
          transcript: '',
          reason: 'NO_VALID_QUESTION',
          startedAt
        });
      }

      const decision = await decideQuestionFromTranscript({
        transcript,
        secretCard,
        config
      });

      return this.applyAiDecision({
        transcript,
        editedQuestion: decision.editedQuestion,
        answer: decision.answer,
        shouldRespond: decision.shouldRespond,
        modelRefused: decision.modelRefused,
        startedAt
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown AI analysis error.';
      // eslint-disable-next-line no-console
      console.error('[HOST] Audio analysis error:', error);
      this.pushToast(`AI analysis failed: ${message}`, 'error');
      return this.toRetryOutcome({
        transcript: '',
        reason: 'ERROR',
        startedAt
      });
    }
  }

  async callVault(calledBy: string | 'AUTO'): Promise<void> {
    if (this.state.phase !== 'INVESTIGATION') {
      throw new Error('Vault can only be called during INVESTIGATION.');
    }

    if (calledBy !== 'AUTO') {
      const currentPlayer = this.getPlayerAtSeat(this.state.round.currentTurnSeatIndex);
      if (currentPlayer.id !== calledBy) {
        throw new Error('Only the current turn player can call vault.');
      }
      this.state.lastActions[calledBy] = 'called vault';
    }

    this.state.round.calledBy = calledBy;
    this.clearInvestigationTimer();

    await this.beginScoring();
  }

  private async beginScoring(): Promise<void> {
    this.state.phase = 'SCORING';
    this.state.round.roundCode = this.generateRoundCode(this.state.round.roundNumber);
    this.state.round.scoringEndsAt = Date.now() + this.state.config.scoringSeconds * 1000;
    this.state.round.submissions = {};

    for (const player of this.state.players) {
      this.state.round.submissionTracker[player.id] = {
        submitted: false,
        lastSeenAt: null,
        validationMessage: null
      };
    }

    try {
      await prepareScoringRound({
        workbookPath: this.state.config.excelPath,
        players: this.state.players,
        roundNumber: this.state.round.roundNumber,
        roundCode: this.state.round.roundCode
      });
    } catch {
      this.addAlert(lockAlert());
    }

    this.clearScoringTimers();
    this.scoringTimer = setTimeout(() => {
      void this.finalizeScoring('timer');
    }, this.state.config.scoringSeconds * 1000);

    this.scoringPollTimer = setInterval(() => {
      void this.pollWorkbookOnce();
    }, this.state.config.pollIntervalMs);

    const calledBy = this.state.round.calledBy;
    if (calledBy === 'AUTO') {
      this.pushToast('Vault called automatically (investigation timer expired).', 'warning');
    } else if (calledBy) {
      const caller = this.getPlayerById(calledBy);
      this.pushToast(`Vault called by ${caller.name}.`, 'warning');
    }

    this.emitState();
  }

  private async pollWorkbookOnce(): Promise<void> {
    if (this.state.phase !== 'SCORING' || this.scoringFinalizing) {
      return;
    }

    const healthAlerts = await detectWorkbookAlerts({
      activePath: this.state.config.excelPath,
      lastKnownMtimeMs: this.state.workbook.lastMtimeMs,
      scoringActive: true
    });
    const existingAlertIds = new Set(this.state.workbook.alerts.map((alert) => alert.id));
    if (healthAlerts.some((alert) => !existingAlertIds.has(alert.id))) {
      this.pushToast('Excel sync issue detected — check OneDrive.', 'warning');
    }
    const nonHealthAlerts = this.state.workbook.alerts.filter(
      (alert) => alert.type !== 'PATH_MISSING' && alert.type !== 'NEWER_DUPLICATE' && alert.type !== 'SYNC_STALE'
    );
    this.setAlerts([...healthAlerts, ...nonHealthAlerts].slice(0, 20));

    let snapshotResult: Awaited<ReturnType<typeof readWorkbookSnapshot>>;
    try {
      snapshotResult = await readWorkbookSnapshot({
        workbookPath: this.state.config.excelPath,
        players: this.state.players,
        roundNumber: this.state.round.roundNumber
      });
    } catch {
      this.addAlert(lockAlert('Workbook read failed. File may be locked or mid-sync.'));
      this.emitState();
      return;
    }

    this.state.workbook.lastMtimeMs = snapshotResult.snapshot.mtimeMs;

    const retryAlert = parseRetryAlert(snapshotResult.parseRetries);
    if (retryAlert) {
      this.addAlert(retryAlert);
    }

    const ackUpdates: Array<{ player: Player; acceptedAt?: string; validationMessage?: string }> = [];
    let changed = false;

    for (const player of this.state.players) {
      const row = snapshotResult.snapshot.submissions[player.id];
      this.state.round.submissionTracker[player.id].lastSeenAt = nowIso();

      if (!row) {
        continue;
      }

      if (this.state.round.submissions[player.id]) {
        continue;
      }

      if (!row.level && !row.color && !row.suit && !row.number) {
        continue;
      }

      const roundMatchesNumber = row.currentRound === this.state.round.roundNumber;

      if (!roundMatchesNumber) {
        const message = `Submission ignored: round mismatch. Expected Round ${this.state.round.roundNumber}.`;
        this.state.round.submissionTracker[player.id].validationMessage = message;
        if (this.state.config.ackWritesEnabled) {
          ackUpdates.push({ player, validationMessage: message });
        }
        changed = true;
        continue;
      }

      const levelRaw = row.level.toUpperCase();
      let guess = '';
      if (levelRaw === 'SAFE') {
        guess = row.color.toUpperCase();
      } else if (levelRaw === 'MEDIUM') {
        guess = row.suit.toUpperCase();
      } else if (levelRaw === 'BOLD') {
        const boldSplitGuess = composeBoldGuess({
          rank: row.number,
          suit: row.suit
        });
        const numberOnly = row.number.toUpperCase();
        const boldLegacyGuess = parseCardCode(numberOnly) ? numberOnly : null;
        guess = boldSplitGuess ?? boldLegacyGuess ?? '';
      }

      if (!isSubmissionLevel(levelRaw) || !validateGuess(levelRaw, guess)) {
        const message = 'Invalid submission format. SAFE=Color, MEDIUM=Suits, BOLD=Number+Suits.';
        const tracker = this.state.round.submissionTracker[player.id];
        const isNewValidation = tracker.validationMessage !== message;
        tracker.validationMessage = message;

        if (isNewValidation) {
          this.addAlert(invalidSubmissionAlert(player.name, message));
          if (this.state.config.ackWritesEnabled) {
            ackUpdates.push({ player, validationMessage: message });
          }
          changed = true;
        }
        continue;
      }

      const submission: Submission = {
        playerId: player.id,
        level: levelRaw,
        guess: normalizeGuess(guess),
        ts: nowIso()
      };

      this.state.round.submissions[player.id] = submission;
      this.state.round.submissionTracker[player.id].submitted = true;
      this.state.round.submissionTracker[player.id].validationMessage = null;
      this.state.lastActions[player.id] = 'submitted';

      if (this.state.config.ackWritesEnabled) {
        ackUpdates.push({ player, acceptedAt: nowIso(), validationMessage: '' });
      }

      changed = true;
    }

    if (this.state.config.ackWritesEnabled && ackUpdates.length > 0) {
      try {
        await writeAcknowledgements({
          workbookPath: this.state.config.excelPath,
          updates: ackUpdates
        });
      } catch {
        this.addAlert(lockAlert());
      }
    }

    if (changed) {
      this.emitState();
    }

    if (this.haveAllPlayersSubmitted()) {
      await this.finalizeScoring('all');
    }
  }

  private haveAllPlayersSubmitted(): boolean {
    return this.state.players.every((player) => Boolean(this.state.round.submissions[player.id]));
  }

  private async finalizeScoring(reason: 'all' | 'timer'): Promise<void> {
    if (this.state.phase !== 'SCORING' || this.scoringFinalizing) {
      return;
    }

    this.scoringFinalizing = true;
    this.clearScoringTimers();

    const secretCard = this.state.roundPrivate.secretCard;
    if (!secretCard) {
      this.scoringFinalizing = false;
      throw new Error('Secret card missing during scoring finalize.');
    }

    const rows: RoundResultRow[] = [];
    const teamRoundTotals = blankTotals();

    for (const player of sortPlayersBySeat(this.state.players)) {
      const submission = this.state.round.submissions[player.id];
      let points = 0;

      if (submission) {
        points = calculateGuessPoints({
          level: submission.level,
          guess: submission.guess,
          secretCard,
          vaultValue: this.state.round.vaultValue
        });
      }

      if (this.state.round.calledBy === player.id) {
        points += points > 0 ? 1 : -1;
      }

      const row: RoundResultRow = {
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        submitted: Boolean(submission),
        level: submission?.level ?? null,
        guess: submission?.guess ?? null,
        points
      };

      rows.push(row);
      teamRoundTotals[player.team] += points;
      this.state.lastActions[player.id] = submission ? 'submitted' : this.state.lastActions[player.id] ?? '';
    }

    this.state.teamScores = {
      A: this.state.teamScores.A + teamRoundTotals.A,
      B: this.state.teamScores.B + teamRoundTotals.B
    };

    const summary: RoundSummary = {
      roundNumber: this.state.round.roundNumber,
      rows,
      teamRoundTotals,
      teamRunningTotals: this.state.teamScores,
      secretCard,
      calledBy: this.state.round.calledBy
    };

    this.state.history.push(summary);
    this.state.round.latestResult = summary;
    this.state.round.scoringEndsAt = null;
    this.state.phase = 'REVEAL';

    if (reason === 'all') {
      this.pushToast('All submissions received — revealing.', 'success');
    } else {
      this.pushToast('Scoring timer expired — revealing.', 'warning');
    }

    this.emitState();
    this.scoringFinalizing = false;
  }

  nextRound(): void {
    if (this.state.phase !== 'REVEAL') {
      throw new Error('Next round is only available in REVEAL phase.');
    }

    if (this.state.round.roundNumber >= this.state.config.rounds) {
      this.state.phase = 'DONE';
      this.pushToast('Game complete. Final scores are ready.', 'success');
      this.emitState();
      return;
    }

    const nextRound = this.state.round.roundNumber + 1;
    this.state.phase = 'SETUP';
    this.resetRoundState(nextRound);
    this.pushToast(`Round ${nextRound} setup started.`, 'info');
    this.emitState();
  }

  async selectWorkbookPath(_nextPath: string): Promise<void> {
    throw new Error('Workbook path is env-locked; set ONE_DRIVE_XLSX_PATH in .env.');
  }
}
