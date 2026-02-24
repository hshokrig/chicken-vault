interface PrivateRevealOverlayProps {
  open: boolean;
  title: string;
  subtitle: string;
}

export function PrivateRevealOverlay({ open, title, subtitle }: PrivateRevealOverlayProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <div className="overlay private-reveal">
      <div className="private-reveal-content">
        <div className="private-label">PRIVATE REVEAL OVERLAY</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}
