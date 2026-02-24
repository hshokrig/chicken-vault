import { GameStatePublic } from '@chicken-vault/shared';

interface QuestionLogPanelProps {
  state: GameStatePublic;
}

export function QuestionLogPanel({ state }: QuestionLogPanelProps): JSX.Element {
  const byId = new Map(state.players.map((player) => [player.id, player.name]));

  return (
    <section className="side-panel">
      <h3>Question Log</h3>
      <div className="panel-scroll">
        {state.round.questions.length === 0 && <p className="muted">No questions yet.</p>}
        {state.round.questions.map((entry, index) => (
          <div className="log-item" key={`${entry.ts}-${index}`}>
            <div className="log-title">{byId.get(entry.askerPlayerId) ?? 'Unknown'}</div>
            <div className="log-body">{entry.question}</div>
            <div className="log-meta">
              {entry.answer} · {new Date(entry.ts).toLocaleTimeString()}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
