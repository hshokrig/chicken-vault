import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { Player, WorkbookAlert, WorkbookCandidate } from '@chicken-vault/shared';
import { makePlayerSheetName, sortPlayersBySeat } from '../utils/sheets.js';
import { nowIso, wait } from '../utils/time.js';

interface RawSheetSubmission {
  currentRound: number | null;
  color: string;
  suit: string;
  number: string;
  level: string;
  acceptedAt: string;
  validationMessage: string;
}

export interface WorkbookSnapshot {
  mtimeMs: number;
  submissions: Record<string, RawSheetSubmission>;
}

export interface WorkbookWriteOptions {
  ackWritesEnabled: boolean;
}

const HEADER_ROW = 1;
const FIRST_DATA_ROW = 2;
const COL_ROUND = 1;
const COL_COLOR = 2;
const COL_SUIT = 3;
const COL_NUMBER = 4;
const COL_LEVEL = 5;
const EXPECTED_HEADERS = ['Round', 'Color', 'Suits', 'Number', 'Level'] as const;
const MAX_DROPDOWN_ROW = 300;
const COLOR_OPTIONS = ['RED', 'BLACK'] as const;
const SUIT_OPTIONS = ['S', 'H', 'D', 'C'] as const;
const LEVEL_OPTIONS = ['SAFE', 'MEDIUM', 'BOLD'] as const;
const RANK_OPTIONS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

function listFormula(options: readonly string[]): string {
  return `"${options.join(',')}"`;
}

function applyListValidation(params: {
  sheet: ExcelJS.Worksheet;
  col: number;
  options: readonly string[];
  title: string;
  message: string;
}): void {
  const { sheet, col, options, title, message } = params;
  for (let row = FIRST_DATA_ROW; row <= MAX_DROPDOWN_ROW; row += 1) {
    sheet.getCell(row, col).dataValidation = {
      type: 'list',
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: title,
      error: message,
      formulae: [listFormula(options)]
    };
  }
}

function ensurePlayerSheetStructureExcel(sheet: ExcelJS.Worksheet): void {
  EXPECTED_HEADERS.forEach((header, index) => {
    sheet.getCell(HEADER_ROW, index + 1).value = header;
  });

  applyListValidation({
    sheet,
    col: COL_COLOR,
    options: COLOR_OPTIONS,
    title: 'Invalid Color',
    message: 'Select RED or BLACK from the dropdown.'
  });
  applyListValidation({
    sheet,
    col: COL_SUIT,
    options: SUIT_OPTIONS,
    title: 'Invalid Suits',
    message: 'Select S, H, D, or C from the dropdown.'
  });
  applyListValidation({
    sheet,
    col: COL_NUMBER,
    options: RANK_OPTIONS,
    title: 'Invalid Number',
    message: 'Select a rank only (A, 2-10, J, Q, K) from the dropdown.'
  });
  applyListValidation({
    sheet,
    col: COL_LEVEL,
    options: LEVEL_OPTIONS,
    title: 'Invalid Level',
    message: 'Select SAFE, MEDIUM, or BOLD from the dropdown.'
  });
}

function cellAddress(row: number, col: number): string {
  return XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
}

function getCellString(sheet: XLSX.WorkSheet | undefined, row: number, col: number): string {
  if (!sheet) {
    return '';
  }
  const cell = sheet[cellAddress(row, col)];
  if (!cell) {
    return '';
  }
  return String(cell.v ?? '').trim();
}

function getCellNumber(sheet: XLSX.WorkSheet | undefined, row: number, col: number): number | null {
  const raw = getCellString(sheet, row, col);
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeRange(sheet: XLSX.WorkSheet): XLSX.Range {
  if (!sheet['!ref']) {
    return { s: { r: 0, c: 0 }, e: { r: 0, c: COL_LEVEL - 1 } };
  }

  try {
    return XLSX.utils.decode_range(sheet['!ref']);
  } catch {
    return { s: { r: 0, c: 0 }, e: { r: 0, c: COL_LEVEL - 1 } };
  }
}

function findRoundRow(sheet: XLSX.WorkSheet, roundNumber: number): number | null {
  const range = decodeRange(sheet);
  const maxRow = Math.max(FIRST_DATA_ROW, range.e.r + 1);

  for (let row = FIRST_DATA_ROW; row <= maxRow; row += 1) {
    const value = getCellNumber(sheet, row, COL_ROUND);
    if (value === roundNumber) {
      return row;
    }
  }

  return null;
}

async function readWorkbookWithRetry(
  workbookPath: string,
  maxAttempts = 5
): Promise<{ workbook: XLSX.WorkBook; mtimeMs: number; retries: number }> {
  let attempt = 0;
  let delayMs = 150;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const stats = await fs.stat(workbookPath);
      const fileBuffer = await fs.readFile(workbookPath);
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      return {
        workbook,
        mtimeMs: stats.mtimeMs,
        retries: attempt - 1
      };
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      await wait(delayMs);
      delayMs *= 2;
    }
  }

  throw new Error('Failed to read workbook');
}

async function loadWorkbookForWriteWithRetry(workbookPath: string, maxAttempts = 4): Promise<ExcelJS.Workbook> {
  let attempt = 0;
  let delayMs = 200;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(workbookPath);
      return workbook;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      await wait(delayMs);
      delayMs *= 2;
    }
  }

  throw new Error('Failed to load workbook for write operations.');
}

async function writeWorkbookForWriteWithRetry(
  workbookPath: string,
  workbook: ExcelJS.Workbook,
  maxAttempts = 4
): Promise<void> {
  let attempt = 0;
  let delayMs = 200;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const buffer = await workbook.xlsx.writeBuffer();
      const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      await fs.writeFile(workbookPath, bytes);
      return;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (attempt >= maxAttempts || (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES')) {
        throw error;
      }
      await wait(delayMs);
      delayMs *= 2;
    }
  }
}

export async function initializeWorkbookForPlayers(params: {
  workbookPath: string;
  players: Player[];
}): Promise<Player[]> {
  const { workbookPath, players } = params;
  const workbook = await loadWorkbookForWriteWithRetry(workbookPath);
  const sorted = sortPlayersBySeat(players);

  const used = new Set<string>();
  const updatedPlayers = sorted.map((player) => {
    const sheetName = makePlayerSheetName(player, used);
    return {
      ...player,
      sheetName
    };
  });

  // Full reset on initialize: delete every existing tab and recreate only player tabs.
  for (const worksheet of [...workbook.worksheets]) {
    workbook.removeWorksheet(worksheet.id);
  }

  for (const player of updatedPlayers) {
    const sheet = workbook.addWorksheet(player.sheetName);
    ensurePlayerSheetStructureExcel(sheet);
  }

  await writeWorkbookForWriteWithRetry(workbookPath, workbook);
  return updatedPlayers;
}

export async function prepareScoringRound(params: {
  workbookPath: string;
  players: Player[];
  roundNumber: number;
  roundCode: string;
}): Promise<void> {
  const { workbookPath, players, roundNumber } = params;
  const workbook = await loadWorkbookForWriteWithRetry(workbookPath);

  for (const player of players) {
    const sheet = workbook.getWorksheet(player.sheetName) ?? workbook.addWorksheet(player.sheetName);
    ensurePlayerSheetStructureExcel(sheet);

    const roundRow = Math.max(FIRST_DATA_ROW, roundNumber + 1);
    sheet.getCell(roundRow, COL_ROUND).value = roundNumber;
    sheet.getCell(roundRow, COL_COLOR).value = '';
    sheet.getCell(roundRow, COL_SUIT).value = '';
    sheet.getCell(roundRow, COL_NUMBER).value = '';
    sheet.getCell(roundRow, COL_LEVEL).value = '';
  }

  await writeWorkbookForWriteWithRetry(workbookPath, workbook);
}

export async function readWorkbookSnapshot(params: {
  workbookPath: string;
  players: Player[];
  roundNumber: number;
}): Promise<{ snapshot: WorkbookSnapshot; parseRetries: number }> {
  const { workbookPath, players, roundNumber } = params;
  const { workbook, mtimeMs, retries } = await readWorkbookWithRetry(workbookPath);

  const submissions: Record<string, RawSheetSubmission> = {};
  for (const player of players) {
    const sheet = workbook.Sheets[player.sheetName];
    const roundRow = sheet ? findRoundRow(sheet, roundNumber) : null;

    if (!sheet || !roundRow) {
      submissions[player.id] = {
        currentRound: null,
        color: '',
        suit: '',
        number: '',
        level: '',
        acceptedAt: '',
        validationMessage: ''
      };
      continue;
    }

    submissions[player.id] = {
      currentRound: getCellNumber(sheet, roundRow, COL_ROUND),
      color: getCellString(sheet, roundRow, COL_COLOR).toUpperCase(),
      suit: getCellString(sheet, roundRow, COL_SUIT).toUpperCase(),
      number: getCellString(sheet, roundRow, COL_NUMBER).toUpperCase(),
      level: getCellString(sheet, roundRow, COL_LEVEL).toUpperCase(),
      acceptedAt: '',
      validationMessage: ''
    };
  }

  return {
    snapshot: {
      mtimeMs,
      submissions
    },
    parseRetries: retries
  };
}

export async function writeAcknowledgements(_params: {
  workbookPath: string;
  updates: Array<{ player: Player; acceptedAt?: string; validationMessage?: string }>;
}): Promise<void> {
  // No-op by design for the column-only workbook format.
}

function normalizeName(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export async function scanWorkbookCandidates(activePath: string): Promise<WorkbookCandidate[]> {
  const dir = path.dirname(activePath);
  const ext = path.extname(activePath).toLowerCase();
  const activeBase = normalizeName(path.basename(activePath, ext));

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const candidates: WorkbookCandidate[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (path.extname(entry.name).toLowerCase() !== '.xlsx') {
      continue;
    }

    const nameBase = normalizeName(path.basename(entry.name, '.xlsx'));
    if (!nameBase.includes(activeBase) && !activeBase.includes(nameBase)) {
      continue;
    }

    const candidatePath = path.join(dir, entry.name);
    const stats = await fs.stat(candidatePath);
    candidates.push({
      path: candidatePath,
      mtimeMs: stats.mtimeMs
    });
  }

  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function detectWorkbookAlerts(params: {
  activePath: string;
  lastKnownMtimeMs: number | null;
  scoringActive: boolean;
  staleThresholdMs?: number;
}): Promise<WorkbookAlert[]> {
  const { activePath, lastKnownMtimeMs, scoringActive, staleThresholdMs = 15000 } = params;
  const alerts: WorkbookAlert[] = [];

  try {
    const stats = await fs.stat(activePath);
    const candidates = await scanWorkbookCandidates(activePath);
    const newest = candidates[0];

    if (newest && newest.path !== activePath && newest.mtimeMs > stats.mtimeMs + 2000) {
      alerts.push({
        id: 'newer-duplicate',
        type: 'NEWER_DUPLICATE',
        message:
          'A newer similarly-named workbook was found. OneDrive conflict copy may be active. Confirm the active file path.',
        createdAt: nowIso(),
        candidates: candidates.slice(0, 8)
      });
    }

    if (scoringActive && lastKnownMtimeMs && Date.now() - lastKnownMtimeMs > staleThresholdMs) {
      alerts.push({
        id: 'sync-stale',
        type: 'SYNC_STALE',
        message:
          'Workbook mtime has not changed recently. OneDrive sync may be paused or the file may be online-only.',
        createdAt: nowIso()
      });
    }
  } catch {
    const candidates = await scanWorkbookCandidates(activePath).catch(() => []);
    alerts.push({
      id: 'path-missing',
      type: 'PATH_MISSING',
      message: 'Configured workbook path is missing. Select the active workbook copy before continuing.',
      createdAt: nowIso(),
      candidates: candidates.slice(0, 8)
    });
  }

  return alerts;
}

export function parseRetryAlert(retries: number): WorkbookAlert | null {
  if (retries <= 0) {
    return null;
  }
  return {
    id: 'parse-retry',
    type: 'PARSE_RETRY',
    message: `Workbook read succeeded after ${retries} retry attempt(s). OneDrive may have been mid-sync.`,
    createdAt: nowIso()
  };
}

export function lockAlert(message = 'Workbook currently locked; close Excel desktop if open.'): WorkbookAlert {
  return {
    id: 'lock-alert',
    type: 'LOCKED',
    message,
    createdAt: nowIso()
  };
}

export function invalidSubmissionAlert(playerName: string, detail: string): WorkbookAlert {
  return {
    id: `invalid-${normalizeName(playerName)}`,
    type: 'INVALID_SUBMISSION',
    message: `${playerName}: ${detail}`,
    createdAt: nowIso()
  };
}
