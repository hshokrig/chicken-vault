import { GameStatePublic } from '@chicken-vault/shared';

export function makeState(): GameStatePublic {
  return {
    phase: 'LOBBY',
    config: {
      rounds: 3,
      investigationSeconds: 180,
      scoringSeconds: 60,
      vaultStart: 4,
      insiderEnabled: true,
      pollIntervalMs: 2000,
      excelPath: '/tmp/chicken.xlsx',
      excelShareUrl: '',
      ackWritesEnabled: false,
      startingDealerSeatIndex: 0
    },
    preflight: {
      confirmedLocalAvailability: false,
      confirmedDesktopExcelClosed: false,
      preflightPassed: false
    },
    players: [
      { id: 'p1', name: 'Ava', team: 'A', seatIndex: 0, sheetName: 'P01_Ava' },
      { id: 'p2', name: 'Bo', team: 'B', seatIndex: 1, sheetName: 'P02_Bo' }
    ],
    round: {
      roundNumber: 1,
      dealerSeatIndex: 0,
      currentTurnSeatIndex: 1,
      dealerId: 'p1',
      vaultValue: 4,
      calledBy: null,
      questions: [],
      roundCode: '',
      investigationEndsAt: null,
      scoringEndsAt: null,
      submissions: {},
      submissionTracker: {
        p1: { submitted: false, lastSeenAt: null, validationMessage: null },
        p2: { submitted: false, lastSeenAt: null, validationMessage: null }
      },
      latestResult: null
    },
    teamScores: { A: 0, B: 0 },
    history: [],
    workbook: {
      activePath: '/tmp/chicken.xlsx',
      lastMtimeMs: null,
      alerts: []
    },
    lastActions: {}
  };
}
