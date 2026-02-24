import { useEffect, useState } from 'react';
import { GameStatePublic, TeamId } from '@chicken-vault/shared';
import { PlayerSeatEditor } from './PlayerSeatEditor';

interface HostControlsProps {
  state: GameStatePublic;
  onAddPlayer: (payload: { name: string; team: TeamId }) => Promise<void>;
  onUpdatePlayer: (playerId: string, payload: { name?: string; team?: TeamId }) => Promise<void>;
  onRemovePlayer: (playerId: string) => Promise<void>;
  onReorderPlayers: (playerIds: string[]) => Promise<void>;
  onConfigChange: (payload: Partial<GameStatePublic['config']>) => Promise<void>;
  onInitializeWorkbook: () => Promise<void>;
  onStartGame: () => Promise<void>;
  onOpenPreflight: () => void;
  onOpenSecretCard: () => void;
  onPickInsider: () => Promise<void>;
  onStartInvestigation: () => Promise<void>;
  onResolveQuestion: (payload: { question: string; answer: 'YES' | 'NO' }) => Promise<void>;
  onCallVault: (calledBy: string | 'AUTO') => Promise<void>;
  onNextRound: () => Promise<void>;
}

export function HostControls({
  state,
  onAddPlayer,
  onUpdatePlayer,
  onRemovePlayer,
  onReorderPlayers,
  onConfigChange,
  onInitializeWorkbook,
  onStartGame,
  onOpenPreflight,
  onOpenSecretCard,
  onPickInsider,
  onStartInvestigation,
  onResolveQuestion,
  onCallVault,
  onNextRound
}: HostControlsProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(true);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerTeam, setNewPlayerTeam] = useState<TeamId>('A');
  const [questionText, setQuestionText] = useState('');
  const [saving, setSaving] = useState(false);

  const [configDraft, setConfigDraft] = useState({
    rounds: state.config.rounds,
    investigationSeconds: state.config.investigationSeconds,
    scoringSeconds: state.config.scoringSeconds,
    vaultStart: state.config.vaultStart,
    insiderEnabled: state.config.insiderEnabled,
    excelPath: state.config.excelPath,
    excelShareUrl: state.config.excelShareUrl,
    ackWritesEnabled: state.config.ackWritesEnabled
  });

  useEffect(() => {
    setConfigDraft({
      rounds: state.config.rounds,
      investigationSeconds: state.config.investigationSeconds,
      scoringSeconds: state.config.scoringSeconds,
      vaultStart: state.config.vaultStart,
      insiderEnabled: state.config.insiderEnabled,
      excelPath: state.config.excelPath,
      excelShareUrl: state.config.excelShareUrl,
      ackWritesEnabled: state.config.ackWritesEnabled
    });
  }, [state.config]);

  const currentTurnPlayer =
    state.phase === 'INVESTIGATION'
      ? state.players.find((player) => player.seatIndex === state.round.currentTurnSeatIndex) ?? null
      : null;

  return (
    <section className="side-panel controls-panel">
      <div className="panel-header">
        <h3>Host Controls</h3>
        <button type="button" className="ghost" onClick={() => setCollapsed((prev) => !prev)}>
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>

      {!collapsed && (
        <div className="panel-scroll">
          {state.phase === 'LOBBY' && (
            <>
              <h4>Preflight</h4>
              <p className="muted small">
                Required before workbook initialization and game start.
                <br />
                Status: {state.preflight.preflightPassed ? 'Ready' : 'Not confirmed'}
              </p>
              <button type="button" onClick={onOpenPreflight}>
                Complete Preflight
              </button>

              <h4>Players</h4>
              <div className="inline-row">
                <input
                  placeholder="Player name"
                  value={newPlayerName}
                  onChange={(event) => setNewPlayerName(event.target.value)}
                />
                <select value={newPlayerTeam} onChange={(event) => setNewPlayerTeam(event.target.value as TeamId)}>
                  <option value="A">Team A</option>
                  <option value="B">Team B</option>
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    if (!newPlayerName.trim()) {
                      return;
                    }
                    setSaving(true);
                    try {
                      await onAddPlayer({ name: newPlayerName.trim(), team: newPlayerTeam });
                      setNewPlayerName('');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                >
                  Add
                </button>
              </div>

              <PlayerSeatEditor
                players={state.players}
                onReorder={onReorderPlayers}
                onRemove={onRemovePlayer}
                onRename={(playerId, name) => onUpdatePlayer(playerId, { name })}
                onTeamChange={(playerId, team) => onUpdatePlayer(playerId, { team })}
              />

              <h4>Game Config</h4>
              <div className="config-grid">
                <label>
                  Rounds
                  <input
                    type="number"
                    min={1}
                    value={configDraft.rounds}
                    onChange={(event) => setConfigDraft((prev) => ({ ...prev, rounds: Number(event.target.value) }))}
                  />
                </label>
                <label>
                  Investigation (s)
                  <input
                    type="number"
                    min={10}
                    value={configDraft.investigationSeconds}
                    onChange={(event) =>
                      setConfigDraft((prev) => ({ ...prev, investigationSeconds: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  Scoring (s)
                  <input
                    type="number"
                    min={10}
                    value={configDraft.scoringSeconds}
                    onChange={(event) =>
                      setConfigDraft((prev) => ({ ...prev, scoringSeconds: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  Vault Start
                  <input
                    type="number"
                    min={1}
                    value={configDraft.vaultStart}
                    onChange={(event) => setConfigDraft((prev) => ({ ...prev, vaultStart: Number(event.target.value) }))}
                  />
                </label>
                <label className="full-row">
                  Excel Path
                  <input
                    value={configDraft.excelPath}
                    onChange={(event) => setConfigDraft((prev) => ({ ...prev, excelPath: event.target.value }))}
                  />
                </label>
                <label className="full-row">
                  Excel Share URL (display only)
                  <input
                    value={configDraft.excelShareUrl}
                    onChange={(event) => setConfigDraft((prev) => ({ ...prev, excelShareUrl: event.target.value }))}
                  />
                </label>
                <label className="inline-checkbox">
                  <input
                    type="checkbox"
                    checked={configDraft.insiderEnabled}
                    onChange={(event) => setConfigDraft((prev) => ({ ...prev, insiderEnabled: event.target.checked }))}
                  />
                  Insider twist enabled
                </label>
                <label className="inline-checkbox">
                  <input
                    type="checkbox"
                    checked={configDraft.ackWritesEnabled}
                    onChange={(event) => setConfigDraft((prev) => ({ ...prev, ackWritesEnabled: event.target.checked }))}
                  />
                  Ack writes enabled
                </label>
              </div>

              <button
                type="button"
                onClick={() => {
                  void onConfigChange(configDraft);
                }}
              >
                Save Config
              </button>

              <p className="muted small">
                Last workbook mtime:{' '}
                {state.workbook.lastMtimeMs ? new Date(state.workbook.lastMtimeMs).toLocaleTimeString() : '—'}
              </p>

              <div className="inline-row">
                <button
                  type="button"
                  onClick={() => {
                    void onInitializeWorkbook();
                  }}
                  disabled={!state.preflight.preflightPassed}
                >
                  Initialize Workbook Now
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onStartGame();
                  }}
                  disabled={!state.preflight.preflightPassed}
                >
                  Start Game
                </button>
              </div>
            </>
          )}

          {state.phase === 'SETUP' && (
            <>
              <h4>Setup</h4>
              <p className="muted small">
                Dealer seat: {state.round.dealerSeatIndex + 1}. Investigation starts at seat{' '}
                {((state.round.dealerSeatIndex + 1) % Math.max(1, state.players.length)) + 1}.
              </p>
              <button type="button" onClick={onOpenSecretCard}>
                Dealer Secret Card Entry
              </button>
              <button
                type="button"
                onClick={() => {
                  void onPickInsider();
                }}
                disabled={!state.config.insiderEnabled}
              >
                Pick Insider
              </button>
              {state.config.insiderEnabled && (
                <p className="muted small">Insider must be picked before investigation can start.</p>
              )}
              <button
                type="button"
                onClick={() => {
                  void onStartInvestigation();
                }}
              >
                Start Investigation
              </button>
            </>
          )}

          {state.phase === 'INVESTIGATION' && (
            <>
              <h4>Investigation</h4>
              <textarea
                placeholder="Type question asked"
                value={questionText}
                onChange={(event) => setQuestionText(event.target.value)}
                rows={3}
              />
              <div className="inline-row">
                <button
                  type="button"
                  onClick={() => {
                    void onResolveQuestion({ question: questionText, answer: 'YES' });
                    setQuestionText('');
                  }}
                >
                  Resolve YES
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onResolveQuestion({ question: questionText, answer: 'NO' });
                    setQuestionText('');
                  }}
                >
                  Resolve NO
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (currentTurnPlayer) {
                    void onCallVault(currentTurnPlayer.id);
                  }
                }}
                disabled={!currentTurnPlayer}
              >
                Call Vault (Current Turn)
              </button>
            </>
          )}

          {state.phase === 'SCORING' && (
            <>
              <h4>Scoring</h4>
              <div className="round-code">{state.round.roundCode}</div>
              <p className="muted small">
                Players: open your sheet, fill Level + Guess, then type YES in Submit.
              </p>
              <p className="muted small">Excel link: {state.config.excelShareUrl || 'Not set'}</p>
            </>
          )}

          {state.phase === 'REVEAL' && (
            <>
              <h4>Reveal</h4>
              <button
                type="button"
                onClick={() => {
                  void onNextRound();
                }}
              >
                Next Round
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
