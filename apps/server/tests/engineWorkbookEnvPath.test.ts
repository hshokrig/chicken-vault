import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { GameEngine } from '../src/game/gameEngine.js';

describe('engine workbook env target', () => {
  afterEach(() => {
    delete process.env.ONE_DRIVE_XLSX_PATH;
  });

  it('initializes player tabs with dropdown validations on ONE_DRIVE_XLSX_PATH target file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chicken-vault-engine-workbook-'));
    const workbookPath = path.join(tmpDir, 'shared.xlsx');

    const seed = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(seed, XLSX.utils.aoa_to_sheet([['legacy']]), 'Legacy');
    await fs.writeFile(workbookPath, XLSX.write(seed, { type: 'buffer', bookType: 'xlsx' }));

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

    await engine.initializeWorkbook();

    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(workbookPath);
    const firstPlayerSheet = book.worksheets[0];
    expect(firstPlayerSheet.name).toMatch(/^P01_/);
    expect(firstPlayerSheet.getCell('B2').dataValidation.formulae).toEqual(['"RED,BLACK"']);
    expect(firstPlayerSheet.getCell('C2').dataValidation.formulae).toEqual(['"S,H,D,C"']);
    expect(firstPlayerSheet.getCell('D2').dataValidation.formulae).toEqual(['"A,2,3,4,5,6,7,8,9,10,J,Q,K"']);
    expect(firstPlayerSheet.getCell('E2').dataValidation.formulae).toEqual(['"SAFE,MEDIUM,BOLD"']);
  });
});
