import { useMemo, useState } from 'react';
import { TeamId } from '@chicken-vault/shared';
import { api } from './api/client';
import { useGameState } from './hooks/useGameState';
import { WarningBanner } from './components/common/WarningBanner';
import { ToastStack } from './components/common/ToastStack';
import { HostControls } from './components/host/HostControls';
import { PreflightModal } from './components/overlays/PreflightModal';
import { PrivateRevealOverlay } from './components/overlays/PrivateRevealOverlay';
import { SecretCardOverlay } from './components/overlays/SecretCardOverlay';
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

export default function App(): JSX.Element {
  const { state, loading, error, toasts, clearToast, refresh } = useGameState();
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [secretCardOpen, setSecretCardOpen] = useState(false);
  const [privateOverlay, setPrivateOverlay] = useState<{ open: boolean; title: string; subtitle: string }>({
    open: false,
    title: '',
    subtitle: ''
  });

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

  const activeTimerEndsAt = state?.phase === 'INVESTIGATION' ? state.round.investigationEndsAt : state?.round.scoringEndsAt;
  const activeTimerTotal =
    state?.phase === 'INVESTIGATION' ? state.config.investigationSeconds : state?.phase === 'SCORING' ? state.config.scoringSeconds : 0;

  const turnPlayer = useMemo(() => {
    if (!state || state.phase !== 'INVESTIGATION') {
      return null;
    }
    return state.players.find((player) => player.seatIndex === state.round.currentTurnSeatIndex) ?? null;
  }, [state]);

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
        onSelectPath={(path) => {
          void run(() => api.selectWorkbookPath(path));
        }}
      />

      {localError && <div className="error-banner">{localError}</div>}

      <header className="app-header">
        <h1>Chicken Vault! Host</h1>
        <div className="header-meta">
          <span>
            Phase: <strong>{state.phase}</strong>
          </span>
          <span>
            Round {state.round.roundNumber} / {state.config.rounds}
          </span>
          {turnPlayer && <span>Turn: {turnPlayer.name}</span>}
        </div>
      </header>

      <main className="app-layout">
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
            onOpenPreflight={() => setPreflightOpen(true)}
            onOpenSecretCard={() => setSecretCardOpen(true)}
            onPickInsider={async () => {
              await run(async () => {
                const reveal = await api.pickInsider();
                setPrivateOverlay({
                  open: true,
                  title: `Insider: ${reveal.insiderName}`,
                  subtitle: `Reveal suit to insider only: ${reveal.suit}`
                });
                window.setTimeout(() => {
                  setPrivateOverlay({ open: false, title: '', subtitle: '' });
                }, 5000);
              });
            }}
            onStartInvestigation={() => run(() => api.startInvestigation())}
            onResolveQuestion={(payload) => run(() => api.resolveQuestion(payload))}
            onCallVault={(calledBy) => run(() => api.callVault(calledBy))}
            onNextRound={() => run(() => api.nextRound())}
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

      <SecretCardOverlay
        open={secretCardOpen}
        onClose={() => setSecretCardOpen(false)}
        onSubmit={(card) => run(() => api.setSecretCard(card))}
      />

      <PrivateRevealOverlay open={privateOverlay.open} title={privateOverlay.title} subtitle={privateOverlay.subtitle} />
    </div>
  );
}
