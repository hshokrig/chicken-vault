import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { GamePhase, GameStatePublic, TeamId } from '@chicken-vault/shared';

const execFileAsync = promisify(execFile);
const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:4000';
const DEFAULT_QUESTION = 'Is the card red?';

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER_URL}${pathname}`, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}) ${pathname}: ${text}`);
  }
  return (await response.json()) as T;
}

async function addPlayer(name: string, team: TeamId): Promise<void> {
  await requestJson('/api/players', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, team })
  });
}

async function ensureInvestigationState(): Promise<GameStatePublic> {
  let state = await requestJson<GameStatePublic>('/api/state');

  if (state.phase === 'LOBBY') {
    if (state.players.length < 2) {
      await addPlayer('Audio A1', 'A');
      await addPlayer('Audio B1', 'B');
      state = await requestJson<GameStatePublic>('/api/state');
    }

    await requestJson('/api/preflight', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmedLocalAvailability: true,
        confirmedDesktopExcelClosed: true
      })
    });

    await requestJson('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insiderEnabled: true
      })
    });

    await requestJson('/api/workbook/initialize', { method: 'POST' });
    await requestJson('/api/game/start', { method: 'POST' });
    state = await requestJson<GameStatePublic>('/api/state');
  }

  if (state.phase === 'REVEAL') {
    await requestJson('/api/game/reveal/next', { method: 'POST' });
    state = await requestJson<GameStatePublic>('/api/state');
  }

  if (state.phase === 'DONE') {
    await requestJson('/api/game/start-real', { method: 'POST' });
    state = await requestJson<GameStatePublic>('/api/state');
  }

  if (state.phase === 'SETUP') {
    await requestJson('/api/game/setup/start-investigation', { method: 'POST' });
    state = await requestJson<GameStatePublic>('/api/state');
  }

  if (state.phase !== 'INVESTIGATION') {
    throw new Error(
      `Server is in ${state.phase} phase. Move to SETUP/INVESTIGATION and retry the script.`
    );
  }

  return state;
}

async function generateVoiceFile(question: string): Promise<string> {
  const audioAiffPath = path.join(os.tmpdir(), `chicken-vault-question-${Date.now()}.aiff`);
  const audioWavPath = path.join(os.tmpdir(), `chicken-vault-question-${Date.now()}.wav`);
  try {
    await execFileAsync('say', ['-o', audioAiffPath, question]);
    await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', audioAiffPath, audioWavPath]);
  } catch (error) {
    throw new Error(
      `Failed to generate test voice with macOS "say/afconvert". ${(error as Error).message}`
    );
  } finally {
    await fs.unlink(audioAiffPath).catch(() => {});
  }
  return audioWavPath;
}

function phaseLabel(phase: GamePhase): string {
  return `phase=${phase}`;
}

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(' ').trim() || DEFAULT_QUESTION;
  const state = await ensureInvestigationState();
  const audioPath = await generateVoiceFile(question);

  try {
    const audioBuffer = await fs.readFile(audioPath);
    const form = new FormData();
    form.append('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'question.wav');

    const outcome = await requestJson<{
      status: string;
      transcript: string;
      editedQuestion: string | null;
      answer: 'YES' | 'NO' | null;
      reason: string;
      latencyMs: number;
    }>('/api/game/investigation/analyze-question-audio', {
      method: 'POST',
      body: form
    });

    // eslint-disable-next-line no-console
    console.log(`[audio-test] ${phaseLabel(state.phase)} turn-seat=${state.round.currentTurnSeatIndex + 1}`);
    // eslint-disable-next-line no-console
    console.log(`[audio-test] input question: ${question}`);
    // eslint-disable-next-line no-console
    console.log('[audio-test] outcome:', JSON.stringify(outcome, null, 2));
  } finally {
    await fs.unlink(audioPath).catch(() => {});
  }
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[audio-test] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
