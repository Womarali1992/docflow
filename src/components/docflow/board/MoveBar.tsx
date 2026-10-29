import React from 'react';
import { MOVE_LABEL, type Move, type MoveTally, type Perspective } from './whoseMove';

const SEGMENTS: Move[] = ['client', 'firm', 'done'];

/**
 * Where a checklist stands, split three ways: with the client, with the
 * advisor, settled. The segments slide when a line changes hands, which is the
 * only time this bar moves.
 */
const MoveBar: React.FC<{ tally: MoveTally; perspective: Perspective; legend?: boolean }> = ({
  tally,
  perspective,
  legend = true,
}) => {
  const labels = MOVE_LABEL[perspective];
  const summary = SEGMENTS.map((m) => `${tally[m]} ${labels[m].toLowerCase()}`).join(', ');

  return (
    <div>
      <div className="df-movebar" role="img" aria-label={`${summary}, of ${tally.total}`}>
        {SEGMENTS.map((m) =>
          tally[m] > 0 ? <span key={m} className={`df-movebar-${m}`} style={{ flexGrow: tally[m] }} /> : null
        )}
      </div>
      {legend && (
        <div className="df-movelegend" aria-hidden="true">
          {SEGMENTS.map((m) => (
            <span key={m}>
              <span className={`df-mdot df-mdot-${m}`} />
              {labels[m]} <span className="df-mono">{tally[m]}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default MoveBar;
