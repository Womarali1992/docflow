import React from 'react';
import type { EngagementCounts } from '@/api/types';
import MoveBar from './board/MoveBar';

/**
 * How far through a checklist an engagement is, and whose move the rest is.
 *
 * "Done" means the advisor has finished with a line — accepted it, or waived it
 * with a reason. A submitted document is not progress until someone has looked
 * at it, which is exactly the distinction the advisor is trying to see: the
 * bar shows it as blue (with you), not green.
 */
const EngagementProgress: React.FC<{ counts?: EngagementCounts | null }> = ({ counts }) => {
  if (!counts || counts.total === 0) {
    return <div className="df-meta">No checklist yet</div>;
  }

  const done = counts.accepted + counts.waived;

  return (
    <div>
      <MoveBar
        tally={{ client: counts.outstanding, firm: counts.submitted, done, total: counts.total }}
        perspective="advisor"
        legend={false}
      />
      <div className="df-meta" style={{ marginTop: 4 }}>
        <span className="df-mono">{done}</span> of <span className="df-mono">{counts.total}</span> settled
      </div>
    </div>
  );
};

export default EngagementProgress;
