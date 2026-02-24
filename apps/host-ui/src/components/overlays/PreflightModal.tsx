import { useState } from 'react';

interface PreflightModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    confirmedLocalAvailability: boolean;
    confirmedDesktopExcelClosed: boolean;
  }) => Promise<void>;
}

export function PreflightModal({ open, onClose, onConfirm }: PreflightModalProps): JSX.Element | null {
  const [localReady, setLocalReady] = useState(false);
  const [desktopClosed, setDesktopClosed] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!open) {
    return null;
  }

  const canConfirm = localReady && desktopClosed && !saving;

  return (
    <div className="overlay preflight" role="dialog" aria-modal="true">
      <div className="overlay-card">
        <h2>OneDrive Preflight Required</h2>
        <p>Confirm both items before initializing workbook or starting game.</p>
        <label className="check-row">
          <input type="checkbox" checked={localReady} onChange={(e) => setLocalReady(e.target.checked)} />
          Workbook is in OneDrive sync folder and set to <strong>Always keep on this device</strong>.
        </label>
        <label className="check-row">
          <input type="checkbox" checked={desktopClosed} onChange={(e) => setDesktopClosed(e.target.checked)} />
          Workbook is not open in desktop Excel.
        </label>
        <div className="overlay-actions">
          <button type="button" onClick={onClose} className="ghost" disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={async () => {
              setSaving(true);
              try {
                await onConfirm({
                  confirmedLocalAvailability: localReady,
                  confirmedDesktopExcelClosed: desktopClosed
                });
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            Confirm Preflight
          </button>
        </div>
      </div>
    </div>
  );
}
