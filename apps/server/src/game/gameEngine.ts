import crypto from 'node:crypto';
import {
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
  detectWorkbookAlerts,
  initializeWorkbookForPlayers,
  invalidSubmissionAlert,
  lockAlert,
  parseRetryAlert,
  prepareScoringRound,
  readWorkbookSnapshot,
  writeAcknowledgements
} from './workbookService.js';
import { calculateGuessPoints, isSubmissionLevel, normalizeGuess, parseCardCode, validateGuess } from '../utils/cards.js';
import { findPlayerBySeatIndex, sortPlayersBySeat } from '../utils/sheets.js';
import { nowIso } from '../utils/time.js';

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

  constructor(events: EngineEvents) {
    this.events = events;

    const defaultConfig: GameConfig = {
      rounds: 3,
      investigationSeconds: 180,
      scoringSeconds: 60,
      vaultStart: 4,
      insiderEnabled: true,
      pollIntervalMs: 2000,
      excelPath: process.env.ONE_DRIVE_XLSX_PATH ?? '',
      excelShareUrl: '',
      ackWritesEnabled: process.env.ACK_WRITES_ENABLED === 'true',
      startingDealerSeatIndex: 0
    };

    this.state = {
      phase: 'LOBBY',
      config: defaultConfig,
      preflight: {
        confirmedLocalAvailability: false,
        confirmedDesktopExcelClosed: false,
        preflightPassed: false
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

  private resetRoundState(roundNumber: number): void {
    this.requirePlayers();
    const playerCount = this.state.players.length;
    const dealerSeatIndex = computeDealerSeatIndex(
      this.state.config.startingDealerSeatIndex,
      roundNumber,
      playerCount
    );
    const dealerPlayer = this.getPlayerAtSeat(dealerSeatIndex);

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
      dealerId: dealerPlayer.id,
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

    if (!this.state.config.excelPath) {
      throw new Error('Excel path is required.');
    }

    try {
      const updatedPlayers = await initializeWorkbookForPlayers({
        workbookPath: this.state.config.excelPath,
        players: this.state.players
      });
      this.state.players = sortPlayersBySeat(updatedPlayers);
      this.state.workbookInitialized = true;
      this.setAlerts([]);
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
    if (!this.state.workbookInitialized) {
      throw new Error('Initialize workbook before starting the game.');
    }

    this.state.phase = 'SETUP';
    this.state.teamScores = blankTotals();
    this.state.history = [];
    this.resetRoundState(1);

    this.pushToast('Game started. Enter secret card for Round 1.', 'success');
    this.emitState();
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

    this.pushToast('Insider selected. Private overlay ready.', 'info');
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
      throw new Error('Secret card is required before investigation.');
    }
    if (this.state.config.insiderEnabled && !this.state.roundPrivate.insiderId) {
      throw new Error('Pick insider before starting investigation when insider twist is enabled.');
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
        players: this.state.players
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

      if (row.submit !== 'YES') {
        continue;
      }

      const expectedRoundCode = this.state.round.roundCode.toUpperCase();
      const matchesRound = row.roundCode.toUpperCase() === expectedRoundCode;
      const statusOpen = row.scoringStatus === 'OPEN';
      const roundMatchesNumber = row.currentRound === this.state.round.roundNumber;

      if (!statusOpen || !matchesRound || !roundMatchesNumber) {
        const message = 'Submission ignored: round code/status mismatch.';
        this.state.round.submissionTracker[player.id].validationMessage = message;
        if (this.state.config.ackWritesEnabled) {
          ackUpdates.push({ player, validationMessage: message });
        }
        changed = true;
        continue;
      }

      const levelRaw = row.level.toUpperCase();
      const guess = row.guess.toUpperCase();

      if (!isSubmissionLevel(levelRaw) || !validateGuess(levelRaw, guess)) {
        const message = 'Invalid Level/Guess format. Check A11/A12.';
        this.state.round.submissionTracker[player.id].validationMessage = message;
        this.addAlert(invalidSubmissionAlert(player.name, message));
        if (this.state.config.ackWritesEnabled) {
          ackUpdates.push({ player, validationMessage: message });
        }
        changed = true;
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

  setWorkbookPath(nextPath: string): void {
    const trimmed = nextPath.trim();
    if (!trimmed) {
      throw new Error('Workbook path is required.');
    }
    this.state.config.excelPath = trimmed;
    this.state.workbook.activePath = trimmed;
    this.state.workbook.alerts = [];
    this.emitState();
  }

  async selectWorkbookPath(nextPath: string): Promise<void> {
    this.setWorkbookPath(nextPath);
    const alerts = await detectWorkbookAlerts({
      activePath: this.state.config.excelPath,
      lastKnownMtimeMs: this.state.workbook.lastMtimeMs,
      scoringActive: this.state.phase === 'SCORING'
    });
    this.setAlerts(alerts);
    this.emitState();
  }
}
