import React from 'react';

/**
 * A shape where the content will be, instead of the word "Loading…".
 *
 * Rows on a list screen, not a spinner: the page does not jump when the answer
 * arrives, and a slow connection looks like a slow connection rather than a
 * broken app. It respects `prefers-reduced-motion` through the stylesheet — the
 * shimmer is the first thing that should stop for someone who asked for less
 * movement.
 */
export const SkeletonRows: React.FC<{ rows?: number; label?: string }> = ({ rows = 4, label = 'Loading' }) => (
  <div className="df-skeleton-list" role="status" aria-live="polite" aria-label={label}>
    {Array.from({ length: rows }, (_, i) => (
      <div className="df-skeleton-row" key={i}>
        <div className="df-skeleton df-skeleton-line" style={{ width: `${58 + ((i * 11) % 28)}%` }} />
        <div className="df-skeleton df-skeleton-line df-skeleton-meta" style={{ width: `${34 + ((i * 7) % 22)}%` }} />
      </div>
    ))}
  </div>
);

export const SkeletonTiles: React.FC<{ tiles?: number }> = ({ tiles = 4 }) => (
  <div className="df-kpi-strip" role="status" aria-live="polite" aria-label="Loading">
    {Array.from({ length: tiles }, (_, i) => (
      <div className="df-kpi" key={i}>
        <div className="df-skeleton df-skeleton-line" style={{ width: '60%' }} />
        <div className="df-skeleton df-skeleton-line" style={{ width: '35%', height: 18, marginTop: 8 }} />
      </div>
    ))}
  </div>
);

export default SkeletonRows;
