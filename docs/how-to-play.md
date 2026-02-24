# Chicken Vault: How To Play (Insider Enabled)

## Direct Answer: Do You Need Physical Cards?

- Real game: **backend auto-picks a random secret card** every round.
- Dealer does not type card codes in the UI.
- Physical cards are **not required**.
- The selected card is printed in server terminal only (private to dealer).

## Workbook Path Rule

- Workbook path is locked to `ONE_DRIVE_XLSX_PATH` from `.env`.
- UI/config cannot override workbook location at runtime.
- If the env path is missing/invalid, initialization/start will fail with a clear error.

## Dealer Role (With Insider On)

- Dealer and host are the same person.
- Dealer is **not** a player and does not have a seat submission sheet.
- Dealer position is shown between two seats and is randomized each round.
- Investigation starts clockwise from that dealer position.

## Who Knows What (With Insider On)

- Dealer/Host knows the full secret card.
- Insider should know only the **suit** (`S/H/D/C`), not the full card.
- Everyone else should not know the secret card or insider identity.

Recommended social rule:
- Insider identity should stay secret from the table.
- Only dealer + insider should know insider information.

## Who Does What

### Host/Dealer

- Runs the host UI.
- Adds players, sets team A/B, sets seat order.
- Starts each round from setup.
- Uses randomized dealer position between two players (shown in UI each round).
- Insider is auto-selected randomly when investigation starts (if enabled).
- Uses `ASK` and `Submit` only during investigation:
  - `ASK` starts microphone recording.
  - `Submit` stops recording and sends audio to AI.
  - AI transcribes and auto-resolves the question as `YES` or `NO`.
- Moves game through investigation, scoring, reveal, next round.

### Players (All)

- Ask one question on their turn.
- During scoring, use the row for the current round and fill:
  - Use dropdowns in `Color`, `Suits`, `Number`, and `Level` (avoid free typing)
  - `Level` = `SAFE` / `MEDIUM` / `BOLD`
  - `Color` (SAFE only) or `Suits` (MEDIUM only) or `Number`+`Suits` (BOLD: rank + suit)

### Insider

- Plays like a normal player.
- Has extra information (suit only) and tries to use it without revealing they are insider.

## Round Flow (Dealer Checklist)

1. **Lobby setup**
   - Complete preflight.
   - Add players and assign teams.
   - Save config.
   - Initialize workbook.
   - `Initialize Workbook Now` clears all existing tabs in the same shared file and recreates tabs only for the current player list.

2. **Start game**
   - Click **Start Real Game**.
   - Phase becomes `SETUP`.

3. **SETUP (each round)**
   - Confirm randomized dealer marker between seats in the table UI.
   - Click **Start Investigation**.
   - Server auto-selects secret card and insider (if enabled).
   - Keep server terminal private; it logs round card and insider details.

4. **INVESTIGATION**
   - Turn starts clockwise from dealer marker.
   - Press `ASK`, let current player speak, then press `Submit`.
   - UI shows `Analyzing...` while AI is transcribing and deciding.
   - If a valid question is detected, AI logs the cleaned question + `YES`/`NO` and rotates turn.
   - If chatter/noise is detected, turn does not advance and dealer retries.
   - Current turn player can call vault, or timer auto-calls.
   - Emergency reset hotkey: press `Shift+R` to reset game back to Lobby (with confirmation).

5. **SCORING**
   - Players submit in Excel.
   - Host watches submission tracker.
   - Round closes when all submitted or timer expires.

6. **REVEAL**
   - Review points and round outcome.
   - Click **Next Round**.

7. **DONE**
   - Final totals shown.

## Notes For You As Host

- Server terminal logs secret selection details each round:
  - `[HOST] Round <n> secret card selected: <CARD>`
  - `[HOST] Round <n> insider selected: <PLAYER_NAME> (suit hint <S/H/D/C>)`
- Keep this terminal private from players.
- Configure AI in `.env`:
  - `OPENAI_API_KEY`
  - `OPENAI_TRANSCRIBE_MODEL` (default `gpt-4o-transcribe`)
  - `OPENAI_QUESTION_MODEL` (default `gpt-5-nano`)
