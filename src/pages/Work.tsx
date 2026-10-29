import React, { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useClients, useDashboard, useQueueWho } from '@/api/queries';
import WhoToggle from '@/components/docflow/WhoToggle';
import { I } from '@/components/docflow/icons';
import { QUEUE_EXPLAIN, QUEUE_FILTERS, QUEUE_TITLE, isQueueFilter, type QueueFilter } from '@/components/docflow/queue';
import { SkeletonRows } from '@/components/docflow/Skeleton';

/**
 * One tile of the home queue, opened out into a list.
 *
 * The rows come from the same `GET /dashboard` read the tiles were counted
 * from, so opening a tile can never show a different number than the tile did.
 * There is no second query and no client-side filtering of a bigger list: the
 * server decides what is in each bucket, once. The same goes for Mine /
 * Everyone (F6): `?who=` is sent to the server, never applied here.
 */

const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "today", "yesterday", "3 days ago" — how long a line has been sitting. */
const ago = (d: Date) => {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
};

const Work: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { who, setWho, shared, ready } = useQueueWho();
  const { data, isPending } = useDashboard({ who, ready });
  const { data: clients = [] } = useClients();

  const filter: QueueFilter = isQueueFilter(params.get('filter')) ? (params.get('filter') as QueueFilter) : 'ready';

  const clientName = useMemo(() => {
    const map = new Map(clients.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? 'Client';
  }, [clients]);

  /* Kept apart rather than unioned: a message row and a checklist row carry
     different fields and open different places. */
  const requestBucket =
    !data || filter === 'unread'
      ? null
      : filter === 'ready'
        ? data.readyToReview
        : filter === 'waiting'
          ? data.waitingOnClients
          : filter === 'overdue'
            ? data.overdue
            : data.needsDecision;
  const unreadBucket = filter === 'unread' ? data?.unreadMessages ?? null : null;
  const shownCount = (requestBucket ?? unreadBucket)?.count ?? 0;

  const counts: Record<QueueFilter, number> = {
    ready: data?.readyToReview.count ?? 0,
    waiting: data?.waitingOnClients.count ?? 0,
    overdue: data?.overdue.count ?? 0,
    needs_decision: data?.needsDecision.count ?? 0,
    unread: data?.unreadMessages.count ?? 0,
  };

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div className="df-client-switcher">
          <button className="df-icon-btn" aria-label="Back to today" onClick={() => navigate('/')}>
            <I.ChevronL size={14} />
          </button>
          <div>
            <h1 className="df-client-name">{QUEUE_TITLE[filter]}</h1>
            <div className="df-client-meta">
              <span>{QUEUE_EXPLAIN[filter]}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="df-section">
        <div className="df-section-head">
          <div className="df-seg" role="tablist">
            {QUEUE_FILTERS.map((f) => (
              <button
                key={f}
                className={filter === f ? 'df-active' : ''}
                onClick={() =>
                  setParams(
                    (current) => {
                      const out = new URLSearchParams(current);
                      out.set('filter', f);
                      return out;
                    },
                    { replace: true }
                  )
                }
              >
                {QUEUE_TITLE[f]} <span className="df-mono" style={{ opacity: 0.6 }}>{counts[f]}</span>
              </button>
            ))}
          </div>
          {shared && (
            <div className="df-right">
              <WhoToggle who={who} onChange={setWho} />
            </div>
          )}
        </div>

        <div className="df-list">
          {isPending && <SkeletonRows rows={4} label="Loading your queue" />}
          {!isPending && data && shownCount === 0 && <div className="df-empty">Nothing here. That is the good outcome.</div>}

          {unreadBucket
            ? unreadBucket.items.map((m) => (
                <div key={m.id} className="df-row" style={{ gridTemplateColumns: '1fr auto' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="df-name">{clientName(m.clientId)}</div>
                    <div className="df-meta">Unread message{shared ? ` · ${m.advisorName ?? 'Unassigned'}` : ''}</div>
                  </div>
                  <button className="df-btn df-sm df-ghost" onClick={() => navigate(`/clients/${m.clientId}`)}>
                    <I.Msg size={12} /> Open thread
                  </button>
                </div>
              ))
            : (requestBucket?.items ?? []).map((item) => {
                /* A line ready to review opens on its file; anything else opens its checklist. */
                const target =
                  filter === 'ready' && item.documentId
                    ? `/review/${item.documentId}`
                    : item.engagementId
                      ? `/engagements/${item.engagementId}`
                      : `/clients/${item.clientId}`;
                return (
                  <div
                    key={item.id}
                    className="df-row df-clickable"
                    style={{ gridTemplateColumns: '1fr auto auto' }}
                    onClick={() => navigate(target)}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter') navigate(target); }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="df-name">{item.title}</div>
                      <div className="df-meta">
                        {clientName(item.clientId)}
                        {item.engagementTitle ? <> · {item.engagementTitle}</> : null}
                        {filter === 'ready' && item.since ? <> · sent {ago(item.since)}</> : null}
                        {filter !== 'ready' && item.dueDate ? <> · due {formatDate(item.dueDate)}</> : null}
                        {filter !== 'ready' && !item.dueDate && item.since ? <> · asked {ago(item.since)}</> : null}
                        {shared && who === 'all' && item.advisorName ? <> · {item.advisorName}</> : null}
                      </div>
                      {item.note && <div className="df-note">“{item.note}”</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {shared && !item.advisorId && <span className="df-pill df-plain">Unassigned</span>}
                      {filter === 'overdue' && <span className="df-pill df-danger">Overdue</span>}
                      {filter !== 'ready' && item.status === 'needs_correction' && <span className="df-pill df-warn">Sent back</span>}
                    </div>
                    <button className="df-btn df-sm df-ghost" onClick={(e) => { e.stopPropagation(); navigate(target); }}>
                      {filter === 'ready' && item.documentId ? 'Review' : 'Open'}
                    </button>
                  </div>
                );
              })}
        </div>
      </div>
    </div>
  );
};

export default Work;
