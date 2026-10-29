import React, { useMemo, useRef } from 'react';
import type { DashboardRequestRef, DashboardSummary } from '@/api/types';
import type { QueueFilter } from '../queue';
import { TONE_PILL, toneClass, toneOf, type Tone } from '../tone';
import { useFlip } from './motion';

/** How many cards a lane shows before "and N more". */
const LANE_SIZE = 6;

type Lane = 'client' | 'firm';

interface Card {
  item: DashboardRequestRef;
  lane: Lane;
  tone: Tone;
  label: string;
}

interface Props {
  data: DashboardSummary | undefined;
  isPending: boolean;
  clientName: (clientId: string) => string;
  /** Show whose client each line is (the firm-wide view). */
  showAdvisor: boolean;
  onOpenCard: (item: DashboardRequestRef, lane: Lane) => void;
  onOpenList: (filter: QueueFilter) => void;
}

const formatDue = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/**
 * The firm's queue as two lanes: what is with the clients, and what is with
 * you. A card that changes hands while the page is open (the client uploads,
 * the dashboard refreshes) glides across to the other lane.
 *
 * Built only from the `GET /dashboard` read the tiles above it count from, so
 * no card can disagree with a number. "Needs your decision" lines are also in
 * the server's waiting bucket (they are still `requested`); here they sit with
 * the advisor, because only the advisor can take one off the list.
 */
const WhoseMoveBoard: React.FC<Props> = ({ data, isPending, clientName, showAdvisor, onOpenCard, onOpenList }) => {
  const root = useRef<HTMLDivElement>(null);

  const lanes = useMemo(() => {
    if (!data) return { client: [] as Card[], firm: [] as Card[] };
    const decided = new Set(data.needsDecision.ids);
    const late = new Set(data.overdue.ids);
    const client: Card[] = data.waitingOnClients.items
      .filter((item) => !decided.has(item.id))
      .map((item): Card => {
        const tone = toneOf({ status: item.status, overdue: late.has(item.id) });
        const label =
          tone === 'sent_back'
            ? 'Sent back'
            : tone === 'overdue'
              ? 'Overdue'
              : item.dueDate
                ? `Due ${formatDue(item.dueDate)}`
                : 'Requested';
        return { item, lane: 'client', tone, label };
      });
    const firm: Card[] = [
      ...data.needsDecision.items.map((item): Card => ({ item, lane: 'firm', tone: 'decision', label: 'Your decision' })),
      ...data.readyToReview.items.map((item): Card => ({ item, lane: 'firm', tone: 'with_firm', label: 'To review' })),
    ].sort((a, b) => a.item.since.getTime() - b.item.since.getTime());
    return { client, firm };
  }, [data]);

  const shown = { client: lanes.client.slice(0, LANE_SIZE), firm: lanes.firm.slice(0, LANE_SIZE) };
  useFlip(
    root,
    `${shown.client.map((c) => c.item.id).join(',')}|${shown.firm.map((c) => c.item.id).join(',')}`
  );

  const lane = (which: Lane) => {
    const all = lanes[which];
    const more = all.length - LANE_SIZE;
    return (
      <div className={`df-lane df-lane-${which}`}>
        <div className="df-lane-head">
          <span className={`df-mdot df-mdot-${which}`} aria-hidden="true" />
          {which === 'client' ? 'Waiting on clients' : 'Your move'}
          <span className="df-mono">{isPending ? '—' : all.length}</span>
        </div>
        {!isPending && all.length === 0 && (
          <div className="df-lane-empty">
            {which === 'client' ? 'Nothing is waiting on a client.' : 'Nothing needs you right now.'}
          </div>
        )}
        <ul className="df-lane-list" aria-label={which === 'client' ? 'Waiting on clients' : 'Your move'}>
          {shown[which].map(({ item, tone, label }) => (
            <li key={item.id} data-flip={item.id} data-lane={which}>
              <button type="button" className={`df-mcard ${toneClass(tone)}`} onClick={() => onOpenCard(item, which)}>
                <span className="df-mcard-title">{item.title}</span>
                <span className={`df-pill ${TONE_PILL[tone]}`}>{label}</span>
                <span className="df-mcard-meta">
                  {clientName(item.clientId)}
                  {item.engagementTitle ? ` · ${item.engagementTitle}` : ''}
                  {showAdvisor ? ` · ${item.advisorName ?? 'Unassigned'}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {more > 0 && (
          <button
            type="button"
            className="df-btn df-sm df-ghost df-lane-more"
            onClick={() => onOpenList(which === 'client' ? 'waiting' : 'ready')}
          >
            And {more} more
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="df-lanes" ref={root}>
      {lane('client')}
      <div className="df-lane-flow" aria-hidden="true">
        <span title="The client sends it">
          <svg width="28" height="12" viewBox="0 0 28 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 6h25M21 1.5 26 6l-5 4.5" />
          </svg>
        </span>
        <span title="You send it back">
          <svg width="28" height="12" viewBox="0 0 28 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M27 6H2M7 1.5 2 6l5 4.5" />
          </svg>
        </span>
      </div>
      {lane('firm')}
    </div>
  );
};

export default WhoseMoveBoard;
