# Chicken Vault! Host App

Local host app for running the party game while screen-sharing. Players do **not** run this app and submit only by editing a shared Excel workbook in Excel Web.

## Hard Requirements (Do This Before Session)

1. Put the workbook inside the host machine's OneDrive-synced folder.
2. Right-click the workbook in Finder/Explorer and set **Always keep on this device**.
3. Keep the workbook closed in desktop Excel during the game.

If #2 or #3 is violated, OneDrive/Excel can create conflict copies or lock the file, which breaks polling and optional write acknowledgements.

## Stack

- Frontend: React + Vite + TypeScript
- Backend: Node.js + TypeScript + Express
- Realtime host updates: Socket.IO
- Excel read/write: SheetJS (`xlsx`) with buffer-based reads (`fs.readFile`) to avoid persistent file locks

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Set `ONE_DRIVE_XLSX_PATH` in `.env` to your local OneDrive workbook path.

4. Start dev servers:

```bash
npm run dev
```

- Backend: `http://localhost:4000`
- Host UI: `http://localhost:5173`

## Host Flow

1. Open host UI.
2. In Lobby, complete preflight checklist (local availability + desktop Excel closed).
3. Add players, assign team A/B, drag seat order.
4. Set config, Excel path, and optional share URL.
5. Click **Initialize Workbook Now** (creates/refreshes player sheets).
6. Click **Start Game**.
7. Setup each round: enter secret card, optionally pick insider (private 5s blackout overlay), start investigation.
8. Investigation: log Q + YES/NO, or call vault.
9. Scoring: players submit in workbook; backend polls every 2s.
10. Reveal: review points and continue next round.

## Player Submission Instructions

Players edit only their assigned worksheet:

- Fill `A11` Level: `SAFE` / `MEDIUM` / `BOLD`
- Fill `A12` Guess:
  - SAFE: `RED` or `BLACK`
  - MEDIUM: `S` / `H` / `D` / `C`
  - BOLD: exact card code (`QD`, `7S`, `AC`, etc.)
- Type `YES` in `A13` Submit as final commit

Backend accepts only submissions with:

- `A9` = `OPEN`
- `A8` RoundCode matching current round
- `A13` = `YES`
- Valid Level/Guess format

## Workbook Contract

One sheet per player named `P##_Name` (sanitized, unique, max 31 chars). Backend initializes these fixed cells:

- `A1`: `CHICKEN VAULT — EDIT ONLY THIS SHEET`
- `A3`: PlayerName
- `A4`: Team (`A`/`B`)
- `A5`: SeatIndex (zero-based)
- `A7`: CurrentRound
- `A8`: RoundCode
- `A9`: ScoringStatus (`OPEN`/`CLOSED`)
- `A11`: Level (player)
- `A12`: Guess (player)
- `A13`: Submit (`YES` by player)
- `A15`: AcceptedAt (optional backend ack)
- `A16`: ValidationMessage (optional backend ack)

Template workbook included at [docs/chicken-vaults.xlsx](/Users/eshohos/Library/CloudStorage/OneDrive-Ericsson/chicken-vault/docs/chicken-vaults.xlsx).

## Dealer / Turn Conventions (Locked)

- Internal seat indexing is zero-based.
- Round 1 dealer is seat `0`.
- Dealer rotates clockwise each round.
- Investigation always starts at seat immediately after dealer.

## Conflict / Sync Handling

The backend continuously checks for sync anomalies:

- Missing configured path
- Newer similarly named `.xlsx` files (possible conflict copies)
- Stale mtime during scoring (possible paused sync / online-only file)
- Transient parse retries during partial sync writes
- Lock errors during write attempts

When detected, the UI shows warning banners and candidate file path buttons so host can pick the active file.

## Commands

```bash
npm run typecheck
npm test
npm run build
```

## Troubleshooting

- **No submissions arriving**:
  - Confirm OneDrive is syncing and not paused.
  - Confirm workbook is **Always keep on this device** (not online-only).
  - Confirm players are editing the correct shared workbook.
- **Workbook lock warning**:
  - Close desktop Excel on host machine.
  - Wait for OneDrive sync to settle and retry.
- **Conflict copy warning**:
  - Use UI candidate buttons to select active local file.
  - Re-share correct workbook link with players if needed.
