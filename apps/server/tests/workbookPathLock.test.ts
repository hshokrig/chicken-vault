import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/gameEngine.js';

const ORIGINAL_WORKBOOK_PATH = process.env.ONE_DRIVE_XLSX_PATH;

function restoreWorkbookEnv(): void {
  if (ORIGINAL_WORKBOOK_PATH === undefined) {
    delete process.env.ONE_DRIVE_XLSX_PATH;
    return;
  }
  process.env.ONE_DRIVE_XLSX_PATH = ORIGINAL_WORKBOOK_PATH;
}

afterEach(() => {
  restoreWorkbookEnv();
});

describe('workbook path env lock', () => {
  it('fails fast when ONE_DRIVE_XLSX_PATH is missing', () => {
    delete process.env.ONE_DRIVE_XLSX_PATH;

    expect(
      () =>
        new GameEngine({
          onState: () => {},
          onToast: () => {}
        })
    ).toThrowError('ONE_DRIVE_XLSX_PATH');
  });

  it('fails fast when ONE_DRIVE_XLSX_PATH does not exist', () => {
    process.env.ONE_DRIVE_XLSX_PATH = path.join(os.tmpdir(), `missing-workbook-${Date.now()}.xlsx`);

    expect(
      () =>
        new GameEngine({
          onState: () => {},
          onToast: () => {}
        })
    ).toThrowError('Workbook file not found');
  });
});
