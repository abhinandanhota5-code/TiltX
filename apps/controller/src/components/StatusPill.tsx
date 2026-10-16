import type { ReactElement } from 'react';
import type { StatusView } from '../lib/status.js';

interface StatusPillProps {
  view: StatusView;
  /** Render as a polite live region (used for the primary connection status). */
  live?: boolean;
}

export function StatusPill({ view, live = false }: StatusPillProps): ReactElement {
  return (
    <span
      className={`status-pill status-pill--${view.tone}`}
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
    >
      <span className="status-pill__dot" aria-hidden="true" />
      <span className="status-pill__label">{view.label}</span>
    </span>
  );
}
