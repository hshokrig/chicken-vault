import { GameStatePublic } from '@chicken-vault/shared';

interface SubmissionTrackerPanelProps {
  state: GameStatePublic;
}

export function SubmissionTrackerPanel({ state }: SubmissionTrackerPanelProps): JSX.Element {
  const players = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);

  return (
    <section className="side-panel">
      <h3>Submission Tracker</h3>
      <div className="panel-scroll">
        {players.map((player) => {
          const tracker = state.round.submissionTracker[player.id];
          const seen = tracker?.lastSeenAt ? new Date(tracker.lastSeenAt).toLocaleTimeString() : '—';
          return (
            <div className="tracker-row" key={player.id}>
              <span>{player.name}</span>
              <span className={tracker?.submitted ? 'status ok' : 'status'}>
                {tracker?.submitted ? 'Submitted' : 'Waiting'}
              </span>
              <span className="seen">Seen {seen}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
