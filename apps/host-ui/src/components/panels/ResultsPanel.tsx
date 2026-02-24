import { GameStatePublic } from '@chicken-vault/shared';

interface ResultsPanelProps {
  state: GameStatePublic;
}

export function ResultsPanel({ state }: ResultsPanelProps): JSX.Element {
  const latest = state.round.latestResult;

  if (!latest) {
    return <p className="muted">Results will appear in REVEAL.</p>;
  }

  return (
    <section className="side-panel">
      <h3>Reveal Results</h3>
      <div className="results-table">
        <div className="results-header">
          <div className="results-head">Player</div>
          <div className="results-head">Level</div>
          <div className="results-head">Guess</div>
          <div className="results-head">Points</div>
        </div>

        {latest.rows.map((row) => (
          <div className="results-row" key={row.playerId}>
            <div className="results-cell">{row.playerName}</div>
            <div className="results-cell">{row.level ?? '—'}</div>
            <div className="results-cell">{row.guess ?? '—'}</div>
            <div className="results-cell">{row.points}</div>
          </div>
        ))}
      </div>
      <div className="totals">Round totals: Team A {latest.teamRoundTotals.A} · Team B {latest.teamRoundTotals.B}</div>
      <div className="totals">Running totals: Team A {latest.teamRunningTotals.A} · Team B {latest.teamRunningTotals.B}</div>
    </section>
  );
}
