import { useEffect, useMemo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { AiQuestionOutcome } from '@chicken-vault/shared';
import { api } from './api/client';
import { useGameState } from './hooks/useGameState';
import { WarningBanner } from './components/common/WarningBanner';
import { ToastStack } from './components/common/ToastStack';
import { HostControls } from './components/host/HostControls';
import { PreflightModal } from './components/overlays/PreflightModal';
import { QuestionLogPanel } from './components/panels/QuestionLogPanel';
import { ResultsPanel } from './components/panels/ResultsPanel';
import { SubmissionTrackerPanel } from './components/panels/SubmissionTrackerPanel';
import { TableScene } from './components/table/TableScene';
import { TimerRing } from './components/table/TimerRing';

function winnerLabel(teamA: number, teamB: number): string {
  if (teamA === teamB) {
    return 'Tie game';
  }
  return teamA > teamB ? 'Team A wins' : 'Team B wins';
}

function extensionForAudioMimeType(mimeType: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes('webm')) {
    return 'webm';
  }
  if (lower.includes('mp4') || lower.includes('aac') || lower.includes('m4a')) {
    return 'm4a';
  }
  if (lower.includes('wav') || lower.includes('wave')) {
    return 'wav';
  }
  if (lower.includes('ogg')) {
    return 'ogg';
  }
  if (lower.includes('mpeg') || lower.includes('mp3')) {
    return 'mp3';
  }
  if (lower.includes('aiff') || lower.includes('x-aiff')) {
    return 'aiff';
  }
  return 'webm';
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || target.isContentEditable;
}

const RIGHT_PANEL_MIN_WIDTH = 210;
const RIGHT_PANEL_MAX_WIDTH = 380;
const RIGHT_PANEL_DEFAULT_WIDTH = 280;
const RIGHT_PANEL_WIDTH_STORAGE_KEY = 'chicken-vault-right-panel-width';

function maxRightPanelWidthForViewport(): number {
  if (typeof window === 'undefined') {
    return RIGHT_PANEL_MAX_WIDTH;
  }
  const byViewport = Math.floor(window.innerWidth * 0.36);
  return Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(RIGHT_PANEL_MAX_WIDTH, byViewport));
}

function clampRightPanelWidth(value: number): number {
  return Math.max(RIGHT_PANEL_MIN_WIDTH, Math.min(maxRightPanelWidthForViewport(), value));
}

function readStoredRightPanelWidth(): number {
  if (typeof window === 'undefined') {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }

  const raw = window.localStorage.getItem(RIGHT_PANEL_WIDTH_STORAGE_KEY);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return RIGHT_PANEL_DEFAULT_WIDTH;
  }
  return clampRightPanelWidth(parsed);
}

export default function App(): JSX.Element {
  const { state, loading, error, toasts, clearToast, refresh } = useGameState();
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(readStoredRightPanelWidth);
  const [resizingRightPanel, setResizingRightPanel] = useState(false);

  const [localError, setLocalError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      setLocalError(null);
      await fn();
      await refresh();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const analyzeQuestionAudio = async (audioBlob: Blob): Promise<AiQuestionOutcome> => {
    try {
      setLocalError(null);
      const formData = new FormData();
      const normalizedBlob = audioBlob.type ? audioBlob : new Blob([audioBlob], { type: 'audio/webm' });
      const extension = extensionForAudioMimeType(normalizedBlob.type || 'audio/webm');
      formData.append('audio', normalizedBlob, `question.${extension}`);
      const outcome = await api.analyzeQuestionAudio(formData);
      await refresh();
      return outcome;
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Question analysis failed');
      throw err;
    }
  };

  const analyzeQuestionText = async (transcript: string): Promise<AiQuestionOutcome> => {
    try {
      setLocalError(null);
      const outcome = await api.analyzeQuestionText({ transcript });
      await refresh();
      return outcome;
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Question analysis failed');
      throw err;
    }
  };

  const activeTimerEndsAt = state?.phase === 'INVESTIGATION' ? state.round.investigationEndsAt : state?.round.scoringEndsAt;
  const activeTimerTotal =
    state?.phase === 'INVESTIGATION' ? state.config.investigationSeconds : state?.phase === 'SCORING' ? state.config.scoringSeconds : 0;

  const turnPlayer = useMemo(() => {
    if (!state || state.phase !== 'INVESTIGATION') {
      return null;
    }
    return state.players.find((player) => player.seatIndex === state.round.currentTurnSeatIndex) ?? null;
  }, [state]);

  useEffect(() => {
    window.localStorage.setItem(RIGHT_PANEL_WIDTH_STORAGE_KEY, String(rightPanelWidth));
  }, [rightPanelWidth]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextEntryTarget(event.target)) {
        return;
      }
      if (!event.shiftKey || event.key.toLowerCase() !== 'r') {
        return;
      }
      if (!state || state.phase === 'LOBBY') {
        return;
      }
      event.preventDefault();
      if (window.confirm('Reset game to lobby? Current round progress will be lost.')) {
        void run(() => api.resetGame());
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [state, run]);

  useEffect(() => {
    const handleResize = (): void => {
      setRightPanelWidth((width) => clampRightPanelWidth(width));
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const startRightPanelResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = rightPanelWidth;
    setResizingRightPanel(true);

    const handlePointerMove = (moveEvent: PointerEvent): void => {
      const nextWidth = clampRightPanelWidth(startWidth + (startX - moveEvent.clientX));
      setRightPanelWidth(nextWidth);
    };

    const stopResizing = (): void => {
      setResizingRightPanel(false);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
  };

  const layoutStyle = {
    '--right-panel-width': `${rightPanelWidth}px`
  } as CSSProperties;

  if (loading) {
    return <div className="screen-state">Loading host UI…</div>;
  }

  if (!state) {
    return <div className="screen-state">Unable to load game state. {error}</div>;
  }

  return (
    <div className="app-root">
      <WarningBanner
        alerts={state.workbook.alerts}
      />

      {localError && <div className="error-banner">{localError}</div>}

      <header className="app-header">
        <h1>Chicken Vault! Dealer</h1>
        <div className="header-meta">
          <span>
            Phase: <strong>{state.phase}</strong>
          </span>
          <span>
            Round {state.round.roundNumber} / {state.config.rounds}
          </span>
          {state.phase !== 'LOBBY' && <span>Reset: Shift+R</span>}
          {turnPlayer && <span>Turn: {turnPlayer.name}</span>}
        </div>
      </header>

      <main className={`app-layout${resizingRightPanel ? ' resizing' : ''}`} style={layoutStyle}>
        <QuestionLogPanel state={state} />

        <section className="table-center">
          <TableScene state={state} />
          <TimerRing
            endsAt={activeTimerEndsAt ?? null}
            totalSeconds={activeTimerTotal}
            phase={state.phase}
            vaultValue={state.round.vaultValue}
          />
          {state.phase === 'DONE' && (
            <div className="done-banner">
              {winnerLabel(state.teamScores.A, state.teamScores.B)} · A {state.teamScores.A} vs B {state.teamScores.B}
            </div>
          )}
        </section>

        <div
          className="panel-resizer"
          role="separator"
          aria-label="Resize right panel"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={startRightPanelResize}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              setRightPanelWidth((width) => clampRightPanelWidth(width + 16));
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              setRightPanelWidth((width) => clampRightPanelWidth(width - 16));
            }
          }}
        />

        <section className="right-stack">
          <SubmissionTrackerPanel state={state} />
          <HostControls
            state={state}
            onAddPlayer={(payload) => run(() => api.addPlayer(payload))}
            onUpdatePlayer={(playerId, payload) => run(() => api.updatePlayer(playerId, payload))}
            onRemovePlayer={(playerId) => run(() => api.removePlayer(playerId))}
            onReorderPlayers={(playerIds) => run(() => api.reorderPlayers(playerIds))}
            onConfigChange={(payload) => run(() => api.updateConfig(payload))}
            onInitializeWorkbook={() => run(() => api.initializeWorkbook())}
            onStartGame={() => run(() => api.startGame())}
            onResetGame={() => run(() => api.resetGame())}
            onRunDemo={() => run(() => api.runDemo())}
            onOpenPreflight={() => setPreflightOpen(true)}
            onStartInvestigation={() => run(() => api.startInvestigation())}
            onAnalyzeQuestionAudio={analyzeQuestionAudio}
            onAnalyzeQuestionText={analyzeQuestionText}
            onCallVault={(calledBy) => run(() => api.callVault(calledBy))}
            onNextRound={() => run(() => api.nextRound())}
            onStartRealGame={() => run(() => api.startRealGame())}
          />
          {state.phase === 'REVEAL' && <ResultsPanel state={state} />}
        </section>
      </main>

      <ToastStack toasts={toasts} onDismiss={clearToast} />

      <PreflightModal
        open={preflightOpen}
        onClose={() => setPreflightOpen(false)}
        onConfirm={(payload) => run(() => api.setPreflight(payload))}
      />
    </div>
  );
}
