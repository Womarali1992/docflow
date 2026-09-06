import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useClient, useEngagements } from '@/api/queries';
import type { Engagement } from '@/api/types';
import { I } from '@/components/docflow/icons';
import ActivityFeed from '@/components/docflow/ActivityFeed';
import MessagesPanel from '@/components/docflow/MessagesPanel';
import ClientAccess from '@/components/docflow/ClientAccess';
import NewEngagementDialog from '@/components/docflow/NewEngagementDialog';
import EngagementProgress from '@/components/docflow/EngagementProgress';
import { SkeletonRows } from '@/components/docflow/Skeleton';

/**
 * One client's page: their engagements, what each is waiting on, the thread,
 * and the account controls.
 *
 * Engagements are the spine — the old screen showed a heap of documents and
 * left the advisor to work out which year they belonged to. Every count on a
 * row is the server's (invariant 15); nothing here adds up its own progress.
 */

const KIND_LABEL: Record<string, string> = {
  individual_tax: 'Individual tax',
  business_tax: 'Business tax',
  other: 'Other work',
  imported: 'Imported',
};

const formatRelative = (d: Date | null) => {
  if (!d) return 'no activity yet';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const Client: React.FC = () => {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { data: client, isPending, error } = useClient(clientId);
  const { data: engagements = [], isPending: engagementsPending } = useEngagements({ clientId });
  const [newEngagementOpen, setNewEngagementOpen] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const { open, closed } = useMemo(() => {
    const sorted = [...engagements].sort((a, b) => {
      const year = (b.taxYear ?? 0) - (a.taxYear ?? 0);
      if (year !== 0) return year;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    return {
      open: sorted.filter((e) => e.status === 'open'),
      closed: sorted.filter((e) => e.status === 'closed'),
    };
  }, [engagements]);

  if (isPending) {
    return <div className="df-page"><div className="df-empty">Loading…</div></div>;
  }
  if (error || !client) {
    return (
      <div className="df-page">
        <div className="df-empty">
          That client is not on your list.{' '}
          <button className="df-link" onClick={() => navigate('/clients')}>Back to clients</button>
        </div>
      </div>
    );
  }

  const initials = client.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  const shown = showClosed ? [...open, ...closed] : open;

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div className="df-client-switcher">
          <button className="df-icon-btn" aria-label="Back to clients" onClick={() => navigate('/clients')}>
            <I.ChevronL size={14} />
          </button>
          <div className="df-client-avatar">{initials}</div>
          <div>
            <h1 className="df-client-name">{client.name}</h1>
            <div className="df-client-meta">
              <span className="df-mono">{client.accountId}</span>
              <span className="df-dot-sep" />
              <span>{client.email}</span>
              <span className="df-dot-sep" />
              <span className="df-live">Active {formatRelative(client.lastActivity)}</span>
            </div>
          </div>
        </div>
        <div className="df-head-actions">
          <ClientAccess client={client} />
          <button className="df-btn df-primary" onClick={() => setNewEngagementOpen(true)}>
            <I.Plus size={13} /> New engagement
          </button>
        </div>
      </div>

      <div className="df-two-col">
        <div style={{ minWidth: 0 }}>
          <div className="df-section">
            <div className="df-section-head">
              <div>
                <div className="df-section-title">Engagements</div>
                <div className="df-section-sub">
                  {open.length} open{closed.length > 0 ? ` · ${closed.length} closed` : ''}
                </div>
              </div>
              {closed.length > 0 && (
                <div className="df-right">
                  <button className="df-btn df-sm df-ghost" onClick={() => setShowClosed((v) => !v)}>
                    {showClosed ? 'Hide closed' : 'Show closed'}
                  </button>
                </div>
              )}
            </div>

            <div className="df-list">
              {engagementsPending && <SkeletonRows rows={3} label="Loading engagements" />}
              {!engagementsPending && engagements.length === 0 && (
                <div className="df-empty">
                  No engagements yet. “New engagement” starts one and can fill its checklist from a template.
                </div>
              )}
              {!engagementsPending && engagements.length > 0 && shown.length === 0 && (
                <div className="df-empty">Nothing open. Show closed engagements to see the file.</div>
              )}
              {shown.map((e) => (
                <EngagementRow key={e.id} engagement={e} onOpen={() => navigate(`/engagements/${e.id}`)} />
              ))}
            </div>
          </div>

          <div className="df-section">
            <div className="df-section-head">
              <div>
                <div className="df-section-title">Activity</div>
                <div className="df-section-sub">Recent events for {client.name}</div>
              </div>
            </div>
            <ActivityFeed clientId={client.id} limit={20} />
          </div>
        </div>

        <MessagesPanel clientId={client.id} meKind="provider" subtitle={`With ${client.name}`} />
      </div>

      <NewEngagementDialog
        open={newEngagementOpen}
        onClose={() => setNewEngagementOpen(false)}
        clientId={client.id}
        clientName={client.name}
        onCreated={(e) => navigate(`/engagements/${e.id}`)}
      />
    </div>
  );
};

/** One engagement, with the two numbers that decide whether it needs a person. */
const EngagementRow: React.FC<{ engagement: Engagement; onOpen: () => void }> = ({ engagement, onOpen }) => {
  const counts = engagement.requestCounts;
  const waitingOnMe = counts?.submitted ?? 0;
  const waitingOnClient = counts?.outstanding ?? 0;
  const overdue = counts?.overdue ?? 0;

  return (
    <div
      className="df-row df-clickable"
      style={{ gridTemplateColumns: '1fr 180px auto auto', alignItems: 'center' }}
      onClick={onOpen}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="df-name">{engagement.title}</div>
        <div className="df-meta">
          {KIND_LABEL[engagement.kind] ?? engagement.kind}
          {engagement.taxYear ? <> · <span className="df-mono">{engagement.taxYear}</span></> : null}
          {counts ? <> · {counts.total} item{counts.total === 1 ? '' : 's'}</> : null}
        </div>
      </div>

      <EngagementProgress counts={counts} />

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {engagement.status === 'closed' && <span className="df-pill df-plain">Closed</span>}
        {overdue > 0 && <span className="df-pill df-danger">{overdue} overdue</span>}
        {waitingOnMe > 0 && <span className="df-pill df-info">{waitingOnMe} to review</span>}
        {waitingOnClient > 0 && <span className="df-pill df-warn">{waitingOnClient} with client</span>}
        {counts && counts.total > 0 && waitingOnMe === 0 && waitingOnClient === 0 && engagement.status === 'open' && (
          <span className="df-pill df-ok">All in</span>
        )}
      </div>

      <button className="df-btn df-ghost df-sm" onClick={(e) => { e.stopPropagation(); onOpen(); }}>Open</button>
    </div>
  );
};

export default Client;
