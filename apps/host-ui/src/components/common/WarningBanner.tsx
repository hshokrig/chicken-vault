import { WorkbookAlert } from '@chicken-vault/shared';

interface WarningBannerProps {
  alerts: WorkbookAlert[];
  onSelectPath?: (path: string) => void;
}

export function WarningBanner({ alerts, onSelectPath }: WarningBannerProps): JSX.Element {
  return (
    <div className="warning-banners">
      <div className="warning-banner warning-hard">
        HARD REQUIREMENT: Keep workbook in OneDrive with <strong>Always keep on this device</strong> and do not
        open it in desktop Excel during the session.
      </div>
      {alerts.map((alert) => (
        <div key={alert.id} className="warning-banner warning-dynamic">
          <div>{alert.message}</div>
          {alert.candidates && alert.candidates.length > 0 && onSelectPath && (
            <div className="candidate-list">
              {alert.candidates.map((candidate) => (
                <button
                  key={candidate.path}
                  type="button"
                  className="candidate-button"
                  onClick={() => onSelectPath(candidate.path)}
                >
                  Use: {candidate.path}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
