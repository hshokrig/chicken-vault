# Chicken Vault! Dealer App

Dealer web app for running Chicken Vault while screen-sharing. The dealer is the host (not a player). Players do not run this app; they only edit the shared workbook.

## Requirements

- Node.js 20+ and npm
- A browser with microphone support (Chrome/Edge recommended)
- Shared workbook exists locally and is configured by `ONE_DRIVE_XLSX_PATH` in `.env`
- OpenAI API key in `.env`

## Install and Run

1. Install dependencies:

```bash
npm install
```

2. Create local env:

```bash
cp .env.example .env
```

3. Fill `.env`:

- `PORT` (optional, default `4000`)
- `ONE_DRIVE_XLSX_PATH` (required absolute/local path to the shared `.xlsx` file)
- `ACK_WRITES_ENABLED` (`true` or `false`)
- `OPENAI_API_KEY` (required)
- `OPENAI_TRANSCRIBE_MODEL` (default `gpt-4o-transcribe`)
- `OPENAI_QUESTION_MODEL` (default `gpt-5-nano`)
- `OPENAI_TRANSCRIBE_LANGUAGE` (optional)
- `ENABLE_AI_TEXT_TEST_ENDPOINT` (`false` for normal use)

Workbook path is env-locked: runtime UI/API overrides are disabled.

4. Start app:

```bash
npm run dev
```

5. Open:

- Host UI: `http://localhost:5173`
- Backend API: `http://localhost:4000`

## What Dealer (Host) Should Do

### Before players join

1. Run `npm run dev`.
2. Open `http://localhost:5173`.
3. In Lobby, add all players and assign teams.
4. Click `Save Config` (this initializes workbook immediately when players exist).
5. `Initialize Workbook Now` always resets the shared workbook tabs: all existing tabs are deleted and recreated only for current players.
6. Click `Start Real Game`.
7. Dealer position is randomly assigned between two players each round.

### At start of each round (SETUP)

1. Confirm the UI dealer marker (between two seats).
2. Click `Start Investigation`.
3. Server auto-selects:
   - Secret card (random, logged only in server terminal)
   - Insider (random, when insider mode is enabled)
4. Turn starts clockwise from dealer marker.

### During investigation

1. Press `ASK` to start recording.
2. Let current player ask one question.
3. Press `Submit` to stop recording and analyze.
4. Wait for `Analyzing...`.
5. If voice recording exists, system analyzes voice first; typed text is used as fallback.
6. System auto-transcribes + auto-answers YES/NO and rotates turn.
7. If result is chatter/noise, turn does not advance; repeat ASK/Submit.
8. If current player calls vault, click `Call Vault (Current Turn)`.
9. To reset the whole game back to Lobby at any time, press `Shift+R` (confirmation required).

### During scoring

1. Watch `Submission Tracker`.
2. Wait until all players submit in Excel or timer ends.

### During reveal

1. Review results.
2. Click `Next Round` until game is done.

## What Players Should Do

Players only edit their own sheet in `chicken-vaults.xlsx`.

For each scoring phase:

1. Find the row for the current round in column `Round` (column `A`).
2. Use dropdown lists in `Color`, `Suits`, `Number`, and `Level` columns (avoid free text).
3. Set `Level` (column `E`) to one of `SAFE`, `MEDIUM`, `BOLD`.
4. Fill exactly one guess column:
   - `SAFE`: use `Color` (column `B`) with `RED` or `BLACK`
   - `MEDIUM`: use `Suits` (column `C`) with `S`, `H`, `D`, or `C`
   - `BOLD` (recommended): use `Number` (column `D`) as rank (`A, 2-10, J, Q, K`) and `Suits` (column `C`) as `S/H/D/C`
   - `BOLD` (legacy accepted): full card in `Number` also works (example `QD`, `8S`)

## AI Question Flow

- Audio transcription model: `gpt-4o-transcribe`
- Question reasoning model: `gpt-5-nano` (Chat Completions with structured schema)
- Input priority: recorded voice first, then typed fallback if voice is unavailable/unclear
- Output contains:
  - cleaned question text
  - YES/NO answer
  - retry reason when no valid question is detected

## Commands

```bash
npm run typecheck
npm test
npm run build
npm run eval:ai -w @chicken-vault/server
npm run test:ai-live -w @chicken-vault/server
npm run simulate:ai-live -w @chicken-vault/server
```

## Troubleshooting

- `Workbook path` errors:
  - Set `ONE_DRIVE_XLSX_PATH` in `.env` to an existing local `.xlsx` file.
- Microphone errors:
  - Allow browser mic access for `localhost:5173`.
- AI analysis errors:
  - Verify `OPENAI_API_KEY` in `.env`.
  - Check backend logs for OpenAI errors.
- Question keeps retrying:
  - Ask one clear card-related question in each recording.
- `Invalid submission format`:
  - SAFE must use `Color` only.
  - MEDIUM must use `Suits` only.
  - BOLD should use `Number` (rank) + `Suits`.
  - Click `Initialize Workbook Now` after pulling latest changes so dropdowns match current format.
