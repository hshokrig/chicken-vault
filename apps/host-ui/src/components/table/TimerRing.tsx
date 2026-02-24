import { useEffect, useMemo, useState } from 'react';

interface TimerRingProps {
  endsAt: number | null;
  totalSeconds: number;
  phase: string;
  vaultValue: number;
}

const RADIUS = 88;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function TimerRing({ endsAt, totalSeconds, phase, vaultValue }: TimerRingProps): JSX.Element {
  const [tick, setTick] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setTick(Date.now());
    }, 250);
    return () => window.clearInterval(interval);
  }, []);

  const remainingSeconds = useMemo(() => {
    if (!endsAt) {
      return 0;
    }
    return Math.max(0, Math.ceil((endsAt - tick) / 1000));
  }, [endsAt, tick]);

  const progress = useMemo(() => {
    if (!endsAt || totalSeconds <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(1, remainingSeconds / totalSeconds));
  }, [endsAt, remainingSeconds, totalSeconds]);

  const strokeOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <div className="timer-ring-wrap">
      <svg className="timer-ring" viewBox="0 0 220 220" aria-hidden="true">
        <circle cx="110" cy="110" r={RADIUS} className="timer-ring-track" />
        <circle
          cx="110"
          cy="110"
          r={RADIUS}
          className="timer-ring-progress"
          style={{ strokeDasharray: CIRCUMFERENCE, strokeDashoffset: strokeOffset }}
        />
      </svg>
      <div className="timer-content">
        <div className="phase-label">{phase}</div>
        <div className="timer-value">{remainingSeconds}s</div>
        <div className="vault-value">V = {vaultValue}</div>
      </div>
    </div>
  );
}
