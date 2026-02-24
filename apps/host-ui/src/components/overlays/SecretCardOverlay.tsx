import { useState } from 'react';

interface SecretCardOverlayProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (card: string) => Promise<void>;
}

const CARD_RE = /^([A2-9TJQK])([SHDC])$/;

export function SecretCardOverlay({ open, onClose, onSubmit }: SecretCardOverlayProps): JSX.Element | null {
  const [cardCode, setCardCode] = useState('');
  const [saving, setSaving] = useState(false);
  const normalized = cardCode.trim().toUpperCase();
  const canSubmit = CARD_RE.test(normalized) && !saving;

  if (!open) {
    return null;
  }

  return (
    <div className="overlay private-reveal">
      <div className="overlay-card">
        <h2>Dealer Private Entry</h2>
        <p>Enter card privately. Value is masked on screen and only printed in your host terminal.</p>
        <label>
          Secret Card (e.g. QD, 7S, AC)
          <input
            type="password"
            value={cardCode}
            onChange={(event) => setCardCode(event.target.value.toUpperCase())}
            placeholder="QD"
            autoFocus
          />
        </label>
        <div className="overlay-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            onClick={async () => {
              setSaving(true);
              try {
                await onSubmit(normalized);
                setCardCode('');
                onClose();
              } finally {
                setSaving(false);
              }
            }}
            disabled={!canSubmit}
          >
            Save Secret Card
          </button>
        </div>
      </div>
    </div>
  );
}
