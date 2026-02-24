import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { Player } from '@chicken-vault/shared';
import { initializeWorkbookForPlayers } from '../src/game/workbookService.js';

function samplePlayers(): Player[] {
  return [
    {
      id: 'p-a',
      name: 'Alice',
      team: 'A',
      seatIndex: 0,
      sheetName: ''
    },
    {
      id: 'p-b',
      name: 'Bob',
      team: 'B',
      seatIndex: 1,
      sheetName: ''
    }
  ];
}

describe('initializeWorkbookForPlayers', () => {
  it('deletes all existing tabs and recreates only current player tabs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chicken-vault-workbook-'));
    const workbookPath = path.join(tmpDir, 'chicken-vaults.xlsx');

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['legacy']]), 'OldData');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['legacy-player']]), 'P01_Legacy');
    await fs.writeFile(workbookPath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

    const updatedPlayers = await initializeWorkbookForPlayers({
      workbookPath,
      players: samplePlayers()
    });

    const refreshed = XLSX.read(await fs.readFile(workbookPath), { type: 'buffer' });
    const expectedSheetNames = updatedPlayers.map((player) => player.sheetName);

    expect(refreshed.SheetNames).toEqual(expectedSheetNames);
    expect(refreshed.Sheets.OldData).toBeUndefined();
    expect(refreshed.Sheets.P01_Legacy).toBeUndefined();

    const aliceSheet = refreshed.Sheets[expectedSheetNames[0]];
    expect(String(aliceSheet.A1?.v ?? '')).toBe('Round');
    expect(String(aliceSheet.B1?.v ?? '')).toBe('Color');
    expect(String(aliceSheet.C1?.v ?? '')).toBe('Suits');
    expect(String(aliceSheet.D1?.v ?? '')).toBe('Number');
    expect(String(aliceSheet.E1?.v ?? '')).toBe('Level');

    const excel = new ExcelJS.Workbook();
    await excel.xlsx.readFile(workbookPath);
    const aliceSheetWithValidation = excel.getWorksheet(expectedSheetNames[0]);
    expect(aliceSheetWithValidation).toBeDefined();
    expect(aliceSheetWithValidation?.getCell('B2').dataValidation.type).toBe('list');
    expect(aliceSheetWithValidation?.getCell('B2').dataValidation.formulae).toEqual(['"RED,BLACK"']);
    expect(aliceSheetWithValidation?.getCell('C2').dataValidation.formulae).toEqual(['"S,H,D,C"']);
    expect(aliceSheetWithValidation?.getCell('D2').dataValidation.formulae).toEqual(['"A,2,3,4,5,6,7,8,9,10,J,Q,K"']);
    expect(aliceSheetWithValidation?.getCell('E2').dataValidation.formulae).toEqual(['"SAFE,MEDIUM,BOLD"']);
  });
});
