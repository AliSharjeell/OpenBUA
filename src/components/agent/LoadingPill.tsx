import { useEffect, useState } from 'react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';

function resolveOrbState(label: string): OrbState {
  const l = label.toLowerCase();
  if (l.includes('search') || l.includes('inspect') || l.includes('look') || l.includes('find')) return 'searching';
  if (l.includes('navigat') || l.includes('connect') || l.includes('bridge') || l.includes('click')) return 'connecting';
  if (l.includes('compose') || l.includes('writ') || l.includes('draft') || l.includes('fill')) return 'composing';
  return 'solving';
}

export function LoadingPill({ label = 'Working' }: { label?: string }) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, (now - startedAt) / 1000);
  const elapsed = seconds < 60
    ? `${seconds.toFixed(1)}s`
    : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;

  const orbState = resolveOrbState(label);

  return (
    <div className="openbua-working-pill pointer-events-auto" role="status">
      <span aria-hidden="true" className="openbua-orb-wrap">
        <ThinkingOrb state={orbState} size={20} theme="dark" />
      </span>
      <span className="openbua-working-label">{label}</span>
      <span aria-hidden="true" className="openbua-working-time">{elapsed}</span>
    </div>
  );
}
