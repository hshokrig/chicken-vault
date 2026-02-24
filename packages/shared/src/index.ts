export type TeamId = 'A' | 'B';

export type GamePhase =
  | 'LOBBY'
  | 'SETUP'
  | 'INVESTIGATION'
  | 'SCORING'
  | 'REVEAL'
  | 'DONE';

export type QuestionAnswer = 'YES' | 'NO';

export type AiQuestionStatus = 'RESOLVED' | 'RETRY';
export type AiQuestionReason = 'OK' | 'NO_VALID_QUESTION' | 'MODEL_REFUSED' | 'ERROR';

export interface AiQuestionOutcome {
  status: AiQuestionStatus;
  transcript: string;
  editedQuestion: string | null;
  answer: QuestionAnswer | null;
  reason: AiQuestionReason;
  latencyMs: number;
}

export type SubmissionLevel = 'SAFE' | 'MEDIUM' | 'BOLD';

export type Suit = 'S' | 'H' | 'D' | 'C';

export interface Player {
  id: string;
  name: string;
  team: TeamId;
  seatIndex: number;
  sheetName: string;
}

export interface GameConfig {
  rounds: number;
  investigationSeconds: number;
  scoringSeconds: number;
  vaultStart: number;
  insiderEnabled: boolean;
  pollIntervalMs: number;
  excelPath: string;
  excelShareUrl: string;
  ackWritesEnabled: boolean;
  startingDealerSeatIndex: number;
}

export interface HostPreflightState {
  confirmedLocalAvailability: boolean;
  confirmedDesktopExcelClosed: boolean;
  preflightPassed: boolean;
}

export interface QuestionEntry {
  askerPlayerId: string;
  question: string;
  answer: QuestionAnswer;
  ts: string;
}

export interface Submission {
  playerId: string;
  level: SubmissionLevel;
  guess: string;
  ts: string;
}

export interface SubmissionTrackerEntry {
  submitted: boolean;
  lastSeenAt: string | null;
  validationMessage: string | null;
}

export interface TeamTotals {
  A: number;
  B: number;
}

export interface RoundResultRow {
  playerId: string;
  playerName: string;
  team: TeamId;
  submitted: boolean;
  level: SubmissionLevel | null;
  guess: string | null;
  points: number;
}

export interface RoundSummary {
  roundNumber: number;
  rows: RoundResultRow[];
  teamRoundTotals: TeamTotals;
  teamRunningTotals: TeamTotals;
  secretCard: string;
  calledBy: string | 'AUTO' | null;
}

export interface WorkbookCandidate {
  path: string;
  mtimeMs: number;
}

export type WorkbookAlertType =
  | 'PATH_MISSING'
  | 'NEWER_DUPLICATE'
  | 'SYNC_STALE'
  | 'LOCKED'
  | 'PARSE_RETRY'
  | 'INVALID_SUBMISSION';

export interface WorkbookAlert {
  id: string;
  type: WorkbookAlertType;
  message: string;
  createdAt: string;
  candidates?: WorkbookCandidate[];
}

export interface RoundStatePublic {
  roundNumber: number;
  dealerSeatIndex: number;
  currentTurnSeatIndex: number;
  dealerId: string | null;
  vaultValue: number;
  calledBy: string | 'AUTO' | null;
  questions: QuestionEntry[];
  roundCode: string;
  investigationEndsAt: number | null;
  scoringEndsAt: number | null;
  submissions: Record<string, Submission>;
  submissionTracker: Record<string, SubmissionTrackerEntry>;
  latestResult: RoundSummary | null;
}

export interface WorkbookState {
  activePath: string;
  lastMtimeMs: number | null;
  alerts: WorkbookAlert[];
}

export type DemoStatus = 'IDLE' | 'RUNNING' | 'READY_TO_START';

export interface DemoState {
  status: DemoStatus;
  targetDurationSeconds: number;
}

export interface GameStatePublic {
  phase: GamePhase;
  config: GameConfig;
  preflight: HostPreflightState;
  players: Player[];
  round: RoundStatePublic;
  teamScores: TeamTotals;
  history: RoundSummary[];
  workbook: WorkbookState;
  demo: DemoState;
  lastActions: Record<string, string>;
}

export interface ToastEvent {
  id: string;
  message: string;
  ts: string;
  level: 'info' | 'warning' | 'success' | 'error';
}

export interface InsiderRevealPayload {
  insiderName: string;
  suit: Suit;
}

export interface ApiError {
  error: string;
}
