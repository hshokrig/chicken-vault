import { GameStatePublic } from '@chicken-vault/shared';
import { motion } from 'framer-motion';

interface TableSceneProps {
  state: GameStatePublic;
}

const PLAYER_ICONS = ['🦄', '🐱', '📘', '🦊', '🐼', '🦉', '🐙', '🐸', '🛡️', '🎲', '🦜', '🐯'];

function teamClass(team: 'A' | 'B'): string {
  return team === 'A' ? 'team-a' : 'team-b';
}

function iconForPlayer(id: string, seatIndex: number): string {
  const key = `${id}-${seatIndex}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return PLAYER_ICONS[hash % PLAYER_ICONS.length];
}

export function TableScene({ state }: TableSceneProps): JSX.Element {
  const players = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
  const count = Math.max(players.length, 1);
  const dealerAngle = -Math.PI / 2 + (2 * Math.PI * (state.round.dealerSeatIndex + 0.5)) / count;
  const dealerX = Math.cos(dealerAngle) * 45;
  const dealerY = Math.sin(dealerAngle) * 39;
  const dealerFromSeat = state.round.dealerSeatIndex + 1;
  const dealerToSeat = ((state.round.dealerSeatIndex + 1) % count) + 1;

  return (
    <div className="table-stage">
      <div className="table-oval" />
      {players.length > 0 && (
        <div className="dealer-position-marker" style={{ left: `${50 + dealerX}%`, top: `${50 + dealerY}%` }}>
          <span className="badge dealer-host">Dealer</span>
          <span className="dealer-seats">
            Between S{dealerFromSeat} and S{dealerToSeat}
          </span>
        </div>
      )}
      {players.map((player, index) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
        const x = Math.cos(angle) * 39;
        const y = Math.sin(angle) * 34;
        const isTurn = state.round.currentTurnSeatIndex === player.seatIndex && state.phase === 'INVESTIGATION';
        const submitted = Boolean(state.round.submissions[player.id]);
        const action = state.lastActions[player.id];
        const icon = iconForPlayer(player.id, player.seatIndex);

        return (
          <motion.div
            key={player.id}
            className={`player-node ${isTurn ? 'turn-active' : ''}`}
            style={{ left: `${50 + x}%`, top: `${50 + y}%` }}
            initial={{ opacity: 0, scale: 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: index * 0.03 }}
          >
            <div className="player-identity">
              <div className={`player-avatar ${teamClass(player.team)}`} aria-label={`${player.name} avatar`}>
                <span>{icon}</span>
              </div>
              <div className="player-caption">
                <div className="player-name">{player.name}</div>
                <div className="player-meta">Seat {player.seatIndex + 1}</div>
              </div>
            </div>
            <div className="badges">
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
