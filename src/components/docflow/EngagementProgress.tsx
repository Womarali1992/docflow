import React from 'react';
import type { EngagementCounts } from '@/api/types';

/**
 * How far through a checklist an engagement is.
 *
 * "Done" means the advisor has finished with a line — accepted it, or waived it
 * with a reason. A submitted document is not progress until someone has looked
 * at it, which is exactly the distinction the advisor is trying to see.
 */
const EngagementProgress: React.FC<{ counts?: EngagementCounts | null }> = ({ counts }) => {
  if (!counts || counts.total === 0) {
    return <div className="df-meta">No checklist yet</div>;
  }

  const done = counts.accepted + counts.waived;
  const pct = Math.round((done / counts.total) * 100);

  return (
    <div>
      <div
        className="df-progress"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${done} of ${counts.total} items settled`}
      >
        <span className="df-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="df-meta" style={{ marginTop: 4 }}>
        <span className="df-mono">{done}</span> of <span className="df-mono">{counts.total}</span> settled
      </div>
    </div>
  );
};

export default EngagementProgress;
