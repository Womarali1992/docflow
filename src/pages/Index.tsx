import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useDashboard } from '@/api/queries';
import { I } from '@/components/docflow/icons';
import ActivityFeed from '@/components/docflow/ActivityFeed';
import { QUEUE_TITLE, type QueueFilter } from '@/components/docflow/queue';

/**
 * The advisor's home: what is waiting, and whose move it is.
 *
 * Every number here is counted from live rows on the server and refreshed on a
 * timer, so it is the same number the client's portal is working from. Nothing
 * on this page adds anything up — a queue an advisor stops believing is a queue
 * they stop opening.
 *
 * The four tiles answer four different questions, and they deliberately
 * overlap: an overdue item is also waiting on the client. Each opens the list
 * behind it rather than trying to say everything in one screen.
 */

const Index: React.FC = () => {
  const navigate = useNavigate();
  const { me } = useAuth();
  const { data, isPending, error } = useDashboard();

  const headerName = me?.kind === 'provider' ? me.name : '';
  const firmName = me?.kind === 'provider' ? me.firmName : null;
  const open = (filter: QueueFilter) => navigate(`/work?filter=${filter}`);

  const tiles: { filter: QueueFilter; count: number; hint: string; tone?: string }[] = [
    { filter: 'ready', count: data?.readyToReview.count ?? 0, hint: 'The client has done their part', tone: 'df-info' },
    { filter: 'waiting', count: data?.waitingOnClients.count ?? 0, hint: 'The ball is with them', tone: 'df-warn' },
    { filter: 'overdue', count: data?.overdue.count ?? 0, hint: 'Waiting, and past the date', tone: 'df-danger' },
    { filter: 'unread', count: data?.unreadMessages.count ?? 0, hint: 'From clients', tone: 'df-info' },
  ];

  const needsDecision = data?.needsDecision;

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Today</h1>
          <div className="df-client-meta">
            <span>{headerName}{firmName ? `, ${firmName}` : ''}</span>
            <span className="df-dot-sep" />
            <span>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>
        <div className="df-head-actions">
          <button className="df-btn" onClick={() => navigate('/documents')}><I.Search size={13} /> Find a document</button>
          <button className="df-btn df-primary" onClick={() => navigate('/clients')}><I.Users size={13} /> Clients</button>
        </div>
      </div>

      {error && <div className="df-section"><div className="df-empty">Could not load your queue. Check your connection and try again.</div></div>}

      <div className="df-kpi-strip">
        {tiles.map((t) => (
          <button
            key={t.filter}
            type="button"
            className={'df-kpi df-kpi-button' + (t.count > 0 ? ' df-kpi-live' : '')}
            onClick={() => open(t.filter)}
            aria-label={`${QUEUE_TITLE[t.filter]}: ${t.count}`}
          >
            <div className="df-kpi-label">{QUEUE_TITLE[t.filter]}</div>
            <div className="df-kpi-value df-mono">{isPending ? '—' : t.count}</div>
            <div className={'df-kpi-trend ' + (t.count > 0 ? (t.tone ?? '') : '')}>
              <span className={t.count > 0 ? undefined : 'df-muted'}>{t.hint}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="df-grid-2-aside">
        <div className="df-section">
          <div className="df-section-head">
            <div>
              <div className="df-section-title">Needs your decision</div>
              <div className="df-section-sub">
                A client has said they do not have something. Only you can take it off the list.
              </div>
            </div>
            {needsDecision && needsDecision.count > 0 && (
              <div className="df-right">
                <button className="df-btn df-sm" onClick={() => open('needs_decision')}>Open all {needsDecision.count}</button>
              </div>
            )}
          </div>
          <div className="df-list">
            {isPending && <div className="df-empty">Loading your queue…</div>}
            {!isPending && (!needsDecision || needsDecision.count === 0) && (
              <div className="df-empty">Nothing waiting on a decision from you.</div>
            )}
            {needsDecision?.items.slice(0, 6).map((item) => (
              <div key={item.id} className="df-row" style={{ gridTemplateColumns: '1fr auto' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="df-name">{item.title}</div>
                  {item.note && <div className="df-meta">“{item.note}”</div>}
                </div>
                <button className="df-btn df-sm df-ghost" onClick={() => navigate(`/clients/${item.clientId}`)}>
                  Open client
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="df-section">
          <div className="df-section-head">
            <div>
              <div className="df-section-title">Activity</div>
              <div className="df-section-sub">Across all clients</div>
            </div>
          </div>
          <ActivityFeed limit={20} compact emptyMessage="No activity yet — uploads and messages will appear here." />
        </div>
      </div>
    </div>
  );
};

export default Index;
