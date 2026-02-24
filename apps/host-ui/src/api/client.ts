import { AiQuestionOutcome, GameStatePublic, Player, TeamId } from '@chicken-vault/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const isFormDataBody = init?.body instanceof FormData;

  if (!isFormDataBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    headers,
    ...init
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  getState: () => request<GameStatePublic>('/api/state'),
  updateConfig: (payload: Partial<GameStatePublic['config']>) =>
    request<GameStatePublic>('/api/config', { method: 'PUT', body: JSON.stringify(payload) }),
  setPreflight: (payload: {
    confirmedLocalAvailability: boolean;
    confirmedDesktopExcelClosed: boolean;
  }) => request<GameStatePublic>('/api/preflight', { method: 'PUT', body: JSON.stringify(payload) }),
  addPlayer: (payload: { name: string; team: TeamId }) =>
    request<Player>('/api/players', { method: 'POST', body: JSON.stringify(payload) }),
  updatePlayer: (playerId: string, payload: { name?: string; team?: TeamId }) =>
    request<GameStatePublic>(`/api/players/${playerId}`, { method: 'PUT', body: JSON.stringify(payload) }),
  removePlayer: (playerId: string) => request<void>(`/api/players/${playerId}`, { method: 'DELETE' }),
  reorderPlayers: (playerIds: string[]) =>
    request<GameStatePublic>('/api/players/reorder', {
      method: 'PUT',
      body: JSON.stringify({ playerIds })
    }),
  initializeWorkbook: () => request<GameStatePublic>('/api/workbook/initialize', { method: 'POST' }),
  startGame: () => request<GameStatePublic>('/api/game/start', { method: 'POST' }),
  resetGame: () => request<GameStatePublic>('/api/game/reset', { method: 'POST' }),
  startRealGame: () => request<GameStatePublic>('/api/game/start-real', { method: 'POST' }),
  runDemo: () => request<GameStatePublic>('/api/game/demo/run', { method: 'POST' }),
  startInvestigation: () => request<GameStatePublic>('/api/game/setup/start-investigation', { method: 'POST' }),
  resolveQuestion: (payload: { question: string; answer: 'YES' | 'NO' }) =>
    request<GameStatePublic>('/api/game/investigation/resolve-question', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  analyzeQuestionAudio: (formData: FormData) =>
    request<AiQuestionOutcome>('/api/game/investigation/analyze-question-audio', {
      method: 'POST',
      body: formData
    }),
  analyzeQuestionText: (payload: { transcript: string }) =>
    request<AiQuestionOutcome>('/api/game/investigation/analyze-question-text', {
      method: 'POST',
      body: JSON.stringify(payload)
    }),
  callVault: (calledBy: string | 'AUTO') =>
    request<GameStatePublic>('/api/game/investigation/call-vault', {
      method: 'POST',
      body: JSON.stringify({ calledBy })
    }),
  nextRound: () => request<GameStatePublic>('/api/game/reveal/next', { method: 'POST' })
};
