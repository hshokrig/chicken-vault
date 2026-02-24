import { WorkbookAlert } from '@chicken-vault/shared';

interface WarningBannerProps {
  alerts: WorkbookAlert[];
}

export function WarningBanner({ alerts }: WarningBannerProps): JSX.Element {
  return (
    <div className="warning-banners">
      {alerts.map((alert) => (
        <div key={alert.id} className="warning-banner warning-dynamic">
          <div>{alert.message}</div>
        </div>
      ))}
    </div>
  );
}
