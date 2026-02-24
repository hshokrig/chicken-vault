import { GameStatePublic } from '@chicken-vault/shared';
import { motion } from 'framer-motion';

interface TableSceneProps {
  state: GameStatePublic;
}

function teamClass(team: 'A' | 'B'): string {
  return team === 'A' ? 'team-a' : 'team-b';
}

export function TableScene({ state }: TableSceneProps): JSX.Element {
  const players = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
  const count = Math.max(players.length, 1);

  return (
    <div className="table-stage">
      <div className="table-oval" />
      {players.map((player, index) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
        const x = Math.cos(angle) * 39;
        const y = Math.sin(angle) * 34;
        const isDealer = state.round.dealerId === player.id;
        const isTurn = state.round.currentTurnSeatIndex === player.seatIndex && state.phase === 'INVESTIGATION';
        const submitted = Boolean(state.round.submissions[player.id]);
        const action = state.lastActions[player.id];

        return (
          <motion.div
            key={player.id}
            className={`player-node ${teamClass(player.team)} ${isTurn ? 'turn-active' : ''}`}
            style={{ left: `${50 + x}%`, top: `${50 + y}%` }}
            initial={{ opacity: 0, scale: 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <div className="player-name">{player.name}</div>
            <div className="player-meta">Seat {player.seatIndex + 1}</div>
            <div className="badges">
              {isDealer && <span className="badge dealer">Dealer</span>}
              {isTurn && <span className="badge turn">Your Turn</span>}
              {submitted && <span className="badge submitted">Submitted</span>}
            </div>
            {action && <div className="micro-bubble">{action}</div>}
          </motion.div>
        );
      })}
    </div>
  );
}
