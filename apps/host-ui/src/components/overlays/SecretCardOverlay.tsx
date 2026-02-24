import { useState } from 'react';

interface SecretCardOverlayProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (card: string) => Promise<void>;
}

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
const SUITS = ['S', 'H', 'D', 'C'];

export function SecretCardOverlay({ open, onClose, onSubmit }: SecretCardOverlayProps): JSX.Element | null {
  const [rank, setRank] = useState('Q');
  const [suit, setSuit] = useState('D');
  const [saving, setSaving] = useState(false);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay private-reveal">
      <div className="overlay-card">
        <h2>Dealer Private Entry</h2>
        <p>Select the secret card for this round. This never appears on public host state.</p>
        <div className="selector-row">
          <label>
            Rank
            <select value={rank} onChange={(e) => setRank(e.target.value)}>
              {RANKS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
          <label>
            Suit
            <select value={suit} onChange={(e) => setSuit(e.target.value)}>
              {SUITS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="overlay-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              setSaving(true);
              try {
                await onSubmit(`${rank}${suit}`);
                onClose();
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
          >
            Save Secret Card
          </button>
        </div>
      </div>
    </div>
  );
}
