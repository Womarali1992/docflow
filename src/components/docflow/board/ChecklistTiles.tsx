import React, { useRef } from 'react';
import type { RequestItem } from '@/api/types';
import { I } from '../icons';
import { toneOf } from '../tone';
import { useFlip, useJustChanged } from './motion';
import { LOOK_LABEL, MOVE_LABEL, lookOf, moveOf, type Move, type Perspective } from './whoseMove';

interface Props {
  /** In the order to show them; each column keeps this order. */
  requests: RequestItem[];
  perspective: Perspective;
  /** What a click on a tile does: usually brings its line into view. */
  onOpen: (request: RequestItem) => void;
  label: string;
}

const COLUMNS: Move[] = ['client', 'firm', 'done'];

const EMPTY: Record<Perspective, Record<Move, string>> = {
  advisor: { client: 'Nothing with the client', firm: 'Nothing for you', done: 'Nothing settled yet' },
  client: { client: 'Nothing for you to do', firm: 'Nothing with your accountant', done: 'Nothing done yet' },
};

/**
 * A checklist at a glance: one tile per line, in three columns — with the
 * client, with the advisor, settled — so what is still needed is one column to
 * read rather than a grid to scan.
 *
 * A line nobody has answered is an empty dashed slot; once a file arrives the
 * slot holds a sheet of paper; a settled line carries a check. When a line
 * changes hands while the page is open its tile glides to its new column and
 * lands there (or recoils, if it was sent back), so the change is seen rather
 * than hunted for.
 */
const ChecklistTiles: React.FC<Props> = ({ requests, perspective, onOpen, label }) => {
  const root = useRef<HTMLDivElement>(null);
  const moved = useJustChanged(requests.map((r) => `${r.id}:${lookOf(r)}`).join('|'));
  useFlip(root, requests.map((r) => `${r.id}:${moveOf(r)}`).join('|'));
  const words = LOOK_LABEL[perspective];

  return (
    <div className="df-tilecols" ref={root} role="group" aria-label={label}>
      {COLUMNS.map((column) => {
        const lines = requests.filter((r) => moveOf(r) === column);
        return (
          <div key={column} className={`df-tilecol df-tilecol-${column}`}>
            <div className="df-tilecol-head">
              <span className={`df-mdot df-mdot-${column}`} aria-hidden="true" />
              {MOVE_LABEL[perspective][column]}
              <span className="df-mono">{lines.length}</span>
            </div>
            {lines.length === 0 ? (
              <div className="df-tilecol-empty">{EMPTY[perspective][column]}</div>
            ) : (
              <ul className="df-tiles" aria-label={MOVE_LABEL[perspective][column]}>
                {lines.map((request) => {
                  const look = lookOf(request);
                  const late = request.overdue && column === 'client';
                  /* Drawn in the line's colour from the rest of the app, so an overdue slot is red, not amber. */
                  const tone = toneOf(request);
                  return (
                    <li key={request.id} data-flip={request.id} data-lane={column}>
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
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ChecklistTiles;
