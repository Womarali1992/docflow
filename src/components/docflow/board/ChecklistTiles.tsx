import React from 'react';
import type { RequestItem } from '@/api/types';
import { I } from '../icons';
import { toneOf } from '../tone';
import { useJustChanged } from './motion';
import { LOOK_LABEL, lookOf, moveOf, type Perspective } from './whoseMove';

interface Props {
  /** In the order to show them; the board does not sort. */
  requests: RequestItem[];
  perspective: Perspective;
  /** What a click on a tile does: usually brings its line into view. */
  onOpen: (request: RequestItem) => void;
  label: string;
}

/**
 * A checklist at a glance: one tile per line.
 *
 * A line nobody has answered is an empty dashed slot; once a file arrives the
 * slot holds a sheet of paper; a settled line carries a check. When a line
 * changes hands while the page is open its tile lands in place (or recoils, if
 * it was sent back), so the change is seen rather than hunted for.
 */
const ChecklistTiles: React.FC<Props> = ({ requests, perspective, onOpen, label }) => {
  const moved = useJustChanged(requests.map((r) => `${r.id}:${lookOf(r)}`).join('|'));
  const words = LOOK_LABEL[perspective];

  return (
    <ul className="df-tiles" aria-label={label}>
      {requests.map((request) => {
        const look = lookOf(request);
        const late = request.overdue && moveOf(request) === 'client';
        /* Drawn in the line's colour from the rest of the app, so an overdue slot is red, not amber. */
        const tone = toneOf(request);
        return (
          <li key={request.id}>
            {/* Keyed by look, so a change restarts the landing animation. */}
            <button
              key={look}
              type="button"
              className={`df-tile df-tile-${tone}${moved.has(request.id) ? ' df-tile-moved' : ''}`}
              onClick={() => onOpen(request)}
              title={request.title}
            >
              <span className="df-tile-title">{request.title}</span>
              <span className="df-tile-state">
                {words[look]}
                {late && <span className="df-tile-late">· overdue</span>}
              </span>
              {look === 'accepted' && (
                <span className="df-tile-check" aria-hidden="true">
                  <I.Check size={11} strokeWidth={2.6} />
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default ChecklistTiles;
