import React, { useEffect, useMemo, useRef } from 'react';
import type { DashboardRequestRef, DashboardSummary } from '@/api/types';
import type { QueueFilter } from '../queue';
import { I } from '../icons';
import { toneClass } from '../tone';
import { seenColumn, useBoardMotion } from './motion';
import { COLUMNS, boardItems, columnTotals, pickRows, type Column } from './rowBoard';

/** How many rows the board shows; the rest are a click away in the queue. */
const ROWS = 8;

const COLUMN_TITLE: Record<Column, string> = {
  client: 'Waiting on client',
  firm: 'Your move',
  done: 'Done this week',
};

interface Props {
  data: DashboardSummary | undefined;
  isPending: boolean;
  clientName: (clientId: string) => string;
  /** Show whose client each line is (the firm-wide view). */
  showAdvisor: boolean;
  onOpenCard: (item: DashboardRequestRef) => void;
  onOpenList: (filter: QueueFilter) => void;
}

/**
 * The firm's work as the landing page draws it: one row per checklist line,
 * and its card sitting with whoever has to act next — the client, you, or
 * nobody, because it is done. When a line moves its card slides along the row:
 * right when the client sends it and again when you accept it, back left when
 * you send it back. That includes moves made while you were on another screen,
 * so accepting a file and coming back here shows it arrive in "Done".
 *
 * Which lines, and in what order, is `rowBoard.ts`; the motion is `motion.ts`.
 */
const WhoseMoveBoard: React.FC<Props> = ({ data, isPending, clientName, showAdvisor, onOpenCard, onOpenList }) => {
  const root = useRef<HTMLDivElement>(null);
  /* The rows on screen, so they hold still while the page is open (see pickRows). */
  const kept = useRef<string[]>([]);

  const all = useMemo(() => (data ? boardItems(data) : []), [data]);
  const totals = useMemo(() => columnTotals(all), [all]);
  // `kept` is read here on purpose: the rows that were on screen at this render.
  const rows = useMemo(() => pickRows(all, kept.current, (id) => seenColumn<Column>(id), ROWS), [all]);
  useEffect(() => {
    kept.current = rows.map((r) => r.item.id);
  }, [rows]);

  useBoardMotion(root, rows.map((r) => `${r.item.id}:${r.column}:${r.tone}`).join('|'));

  const hidden = all.length - rows.length;

  return (
    <div className="df-kboard" ref={root}>
      <div className="df-kboard-head" aria-hidden="true">
        <span />
        <div className="df-kboard-cols">
          {COLUMNS.map((c) => (
            <span key={c} className={`df-kboard-col df-kboard-col-${c}`}>
              <span className={`df-mdot df-mdot-${c}`} />
              {COLUMN_TITLE[c]}
              <span className="df-mono">{isPending ? '—' : totals[c]}</span>
            </span>
          ))}
        </div>
      </div>

      {!isPending && rows.length === 0 && (
        <div className="df-lane-empty">Nothing open, and nothing settled this week.</div>
      )}

      <ul className="df-krows" aria-label="Whose move, one line per row">
        {rows.map(({ item, column, tone, label }) => (
          <li key={item.id} className="df-krow">
            <div className="df-krow-item">
              <div className="df-krow-title">{item.title}</div>
              <div className="df-krow-meta">
                {clientName(item.clientId)}
                {item.engagementTitle ? ` · ${item.engagementTitle}` : ''}
                {showAdvisor ? ` · ${item.advisorName ?? 'Unassigned'}` : ''}
              </div>
            </div>
            <div className="df-krow-track">
              {COLUMNS.map((c) => (
                <div key={c} className={`df-kcell df-kcell-${c}`} data-cell={`${item.id}:${c}`}>
                  {c === column && (
                    <button
                      type="button"
                      className={`df-kcard ${toneClass(tone)}`}
                      data-card={item.id}
                      data-col={column}
                      data-tone={tone}
                      onClick={() => onOpenCard(item)}
                      aria-label={`${item.title}, ${clientName(item.clientId)}: ${label}. ${COLUMN_TITLE[column]}.`}
                    >
                      {column === 'done' && tone === 'accepted' && (
                        <span className="df-kcard-check" aria-hidden="true">
                          <I.Check size={10} strokeWidth={2.8} />
                        </span>
                      )}
                      {label}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {hidden > 0 && (
        <div className="df-kboard-more">
          <span>
            Showing <span className="df-mono">{rows.length}</span> of <span className="df-mono">{all.length}</span>
          </span>
          {totals.client > 0 && (
            <button type="button" className="df-btn df-sm df-ghost" onClick={() => onOpenList('waiting')}>
              All waiting on clients
            </button>
          )}
          {totals.firm > 0 && (
            <button type="button" className="df-btn df-sm df-ghost" onClick={() => onOpenList('ready')}>
              All ready to review
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default WhoseMoveBoard;
