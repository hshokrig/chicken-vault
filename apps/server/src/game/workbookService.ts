import fs from 'node:fs/promises';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { Player, WorkbookAlert, WorkbookCandidate } from '@chicken-vault/shared';
import { makePlayerSheetName, sortPlayersBySeat } from '../utils/sheets.js';
import { nowIso, wait } from '../utils/time.js';

interface RawSheetSubmission {
  scoringStatus: string;
  roundCode: string;
  currentRound: number | null;
  level: string;
  guess: string;
  submit: string;
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

function getCellString(sheet: XLSX.WorkSheet | undefined, address: string): string {
  if (!sheet?.[address]) {
    return '';
  }
  return String(sheet[address].v ?? '').trim();
}

function getCellNumber(sheet: XLSX.WorkSheet | undefined, address: string): number | null {
  const value = getCellString(sheet, address);
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
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

async function writeWorkbookWithRetry(
  workbookPath: string,
  workbook: XLSX.WorkBook,
  maxAttempts = 4
): Promise<void> {
  let attempt = 0;
  let delayMs = 200;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      await fs.writeFile(workbookPath, buffer);
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

function ensureCell(sheet: XLSX.WorkSheet, address: string, value: string | number): void {
  sheet[address] = { t: typeof value === 'number' ? 'n' : 's', v: value };
}

function setSheetRange(sheet: XLSX.WorkSheet, range = 'A1:A16'): void {
  sheet['!ref'] = range;
}

function createPlayerSheet(player: Player): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {};
  ensureCell(sheet, 'A1', 'CHICKEN VAULT — EDIT ONLY THIS SHEET');
  ensureCell(sheet, 'A3', player.name);
  ensureCell(sheet, 'A4', player.team);
  ensureCell(sheet, 'A5', player.seatIndex);
  ensureCell(sheet, 'A7', 0);
  ensureCell(sheet, 'A8', '');
  ensureCell(sheet, 'A9', 'CLOSED');
  ensureCell(sheet, 'A11', '');
  ensureCell(sheet, 'A12', '');
  ensureCell(sheet, 'A13', '');
  ensureCell(sheet, 'A15', '');
  ensureCell(sheet, 'A16', '');
  setSheetRange(sheet);
  return sheet;
}

function upsertPlayerSheet(sheet: XLSX.WorkSheet, player: Player): XLSX.WorkSheet {
  ensureCell(sheet, 'A1', 'CHICKEN VAULT — EDIT ONLY THIS SHEET');
  ensureCell(sheet, 'A3', player.name);
  ensureCell(sheet, 'A4', player.team);
  ensureCell(sheet, 'A5', player.seatIndex);
  if (!sheet['A7']) {
    ensureCell(sheet, 'A7', 0);
  }
  if (!sheet['A8']) {
    ensureCell(sheet, 'A8', '');
  }
  if (!sheet['A9']) {
    ensureCell(sheet, 'A9', 'CLOSED');
  }
  if (!sheet['A11']) {
    ensureCell(sheet, 'A11', '');
  }
  if (!sheet['A12']) {
    ensureCell(sheet, 'A12', '');
  }
  if (!sheet['A13']) {
    ensureCell(sheet, 'A13', '');
  }
  if (!sheet['A15']) {
    ensureCell(sheet, 'A15', '');
  }
  if (!sheet['A16']) {
    ensureCell(sheet, 'A16', '');
  }
  setSheetRange(sheet);
  return sheet;
}

async function loadWorkbookOrCreate(workbookPath: string): Promise<XLSX.WorkBook> {
  try {
    const { workbook } = await readWorkbookWithRetry(workbookPath, 2);
    return workbook;
  } catch {
    return XLSX.utils.book_new();
  }
}

function removeLegacyPlayerSheets(workbook: XLSX.WorkBook): void {
  const playerSheets = workbook.SheetNames.filter((sheetName) => /^P\d{2}_/.test(sheetName));
  for (const sheetName of playerSheets) {
    delete workbook.Sheets[sheetName];
  }
  workbook.SheetNames = workbook.SheetNames.filter((sheetName) => !/^P\d{2}_/.test(sheetName));
}

export async function initializeWorkbookForPlayers(params: {
  workbookPath: string;
  players: Player[];
}): Promise<Player[]> {
  const { workbookPath, players } = params;
  const workbook = await loadWorkbookOrCreate(workbookPath);
  const sorted = sortPlayersBySeat(players);

  removeLegacyPlayerSheets(workbook);

  const used = new Set<string>();
  const updatedPlayers = sorted.map((player) => {
    const sheetName = makePlayerSheetName(player, used);
    return {
      ...player,
      sheetName
    };
  });

  for (const player of updatedPlayers) {
    const existing = workbook.Sheets[player.sheetName];
    const sheet = existing ? upsertPlayerSheet(existing, player) : createPlayerSheet(player);
    workbook.Sheets[player.sheetName] = sheet;
    if (!workbook.SheetNames.includes(player.sheetName)) {
      workbook.SheetNames.push(player.sheetName);
    }
  }

  await writeWorkbookWithRetry(workbookPath, workbook);
  return updatedPlayers;
}

export async function prepareScoringRound(params: {
  workbookPath: string;
  players: Player[];
  roundNumber: number;
  roundCode: string;
}): Promise<void> {
  const { workbookPath, players, roundNumber, roundCode } = params;
  const workbook = await loadWorkbookOrCreate(workbookPath);

  for (const player of players) {
    const existing = workbook.Sheets[player.sheetName];
    const sheet = existing ? upsertPlayerSheet(existing, player) : createPlayerSheet(player);
    ensureCell(sheet, 'A7', roundNumber);
    ensureCell(sheet, 'A8', roundCode);
    ensureCell(sheet, 'A9', 'OPEN');
    ensureCell(sheet, 'A11', '');
    ensureCell(sheet, 'A12', '');
    ensureCell(sheet, 'A13', '');
    ensureCell(sheet, 'A15', '');
    ensureCell(sheet, 'A16', '');
    setSheetRange(sheet);

    workbook.Sheets[player.sheetName] = sheet;
    if (!workbook.SheetNames.includes(player.sheetName)) {
      workbook.SheetNames.push(player.sheetName);
    }
  }

  await writeWorkbookWithRetry(workbookPath, workbook);
}

export async function readWorkbookSnapshot(params: {
  workbookPath: string;
  players: Player[];
}): Promise<{ snapshot: WorkbookSnapshot; parseRetries: number }> {
  const { workbookPath, players } = params;
  const { workbook, mtimeMs, retries } = await readWorkbookWithRetry(workbookPath);

  const submissions: Record<string, RawSheetSubmission> = {};
  for (const player of players) {
    const sheet = workbook.Sheets[player.sheetName];
    submissions[player.id] = {
      scoringStatus: getCellString(sheet, 'A9').toUpperCase(),
      roundCode: getCellString(sheet, 'A8').toUpperCase(),
      currentRound: getCellNumber(sheet, 'A7'),
      level: getCellString(sheet, 'A11').toUpperCase(),
      guess: getCellString(sheet, 'A12').toUpperCase(),
      submit: getCellString(sheet, 'A13').toUpperCase(),
      acceptedAt: getCellString(sheet, 'A15'),
      validationMessage: getCellString(sheet, 'A16')
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

export async function writeAcknowledgements(params: {
  workbookPath: string;
  updates: Array<{ player: Player; acceptedAt?: string; validationMessage?: string }>;
}): Promise<void> {
  const { workbookPath, updates } = params;
  if (updates.length === 0) {
    return;
  }

  const workbook = await loadWorkbookOrCreate(workbookPath);

  for (const entry of updates) {
    const sheet = workbook.Sheets[entry.player.sheetName];
    if (!sheet) {
      continue;
    }
    if (entry.acceptedAt) {
      ensureCell(sheet, 'A15', entry.acceptedAt);
    }
    if (entry.validationMessage !== undefined) {
      ensureCell(sheet, 'A16', entry.validationMessage);
    }
    setSheetRange(sheet);
  }

  await writeWorkbookWithRetry(workbookPath, workbook);
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
    id: `invalid-${normalizeName(playerName)}-${Date.now()}`,
    type: 'INVALID_SUBMISSION',
    message: `${playerName}: ${detail}`,
    createdAt: nowIso()
  };
}
