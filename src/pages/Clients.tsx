import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClients } from '@/api/queries';
import type { Client } from '@/api/types';
import { ACCESS_LABEL, accessState, type AccessState } from '@/utils/clientAccess';
import { downloadCsv } from '@/utils/csv';
import { I } from '@/components/docflow/icons';
import NewClientDialog from '@/components/docflow/NewClientDialog';
import { SkeletonRows } from '@/components/docflow/Skeleton';
import LoadError from '@/components/docflow/LoadError';

/**
 * The client directory — the advisor's way into everything else.
 *
 * The badges are the point of the screen: "needs attention" is not a mood, it
 * is `pendingUpdates` or `unreadMessages` counted on the server, and portal
 * access is derived from the account fields rather than guessed. An advisor
 * should be able to see, in one pass down the page, who is waiting on them and
 * who has never been able to sign in.
 */

type Sort = 'activity' | 'name' | 'attention';
type Filter = 'all' | 'attention' | 'no_access';

const SORT_LABEL: Record<Sort, string> = {
  activity: 'Recent activity',
  name: 'Name',
  attention: 'Needs attention',
};

const formatRelative = (d: Date | null) => {
  if (!d) return 'no activity yet';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const initialsOf = (name: string) => name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

const attentionScore = (c: Client) => c.pendingUpdates + c.unreadMessages;

/** Who cannot get in: never invited, or invited and never accepted. */
const lacksAccess = (state: AccessState) => state === 'not_invited' || state === 'invited';

const Clients: React.FC = () => {
  const navigate = useNavigate();
  const { data: clients = [], isPending, error, refetch } = useClients();

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('activity');
  const [filter, setFilter] = useState<Filter>('all');
  const [newClientOpen, setNewClientOpen] = useState(false);

  const counts = useMemo(() => {
    const attention = clients.filter((c) => attentionScore(c) > 0).length;
    const noAccess = clients.filter((c) => lacksAccess(accessState(c))).length;
    return { all: clients.length, attention, noAccess };
  }, [clients]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = clients;
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.accountId.toLowerCase().includes(q));
    if (filter === 'attention') list = list.filter((c) => attentionScore(c) > 0);
    if (filter === 'no_access') list = list.filter((c) => lacksAccess(accessState(c)));

    return [...list].sort((a, b) => {
      // A deactivated client is still on the file, but never at the top of it.
      const off = Number(Boolean(a.deactivatedAt)) - Number(Boolean(b.deactivatedAt));
      if (off !== 0) return off;
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'attention') {
        const d = attentionScore(b) - attentionScore(a);
        if (d !== 0) return d;
      }
      return (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0);
    });
  }, [clients, query, filter, sort]);

  const exportCsv = () =>
    downloadCsv(
      'clients',
      ['Name', 'Email', 'Account', 'Portal access', 'Pending', 'Unread', 'Documents', 'Last activity'],
      visible.map((c) => [
        c.name,
        c.email,
        c.accountId,
        ACCESS_LABEL[accessState(c)].label,
        c.pendingUpdates,
        c.unreadMessages,
        c.documentsCount,
        c.lastActivity ? c.lastActivity.toISOString() : '',
      ])
    );

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Clients</h1>
          <div className="df-client-meta">
            <span>{counts.all} on file</span>
            <span className="df-dot-sep" />
            <span>{counts.attention} need attention</span>
            <span className="df-dot-sep" />
            <span>{counts.noAccess} without portal access</span>
          </div>
        </div>
        <div className="df-head-actions">
          <button className="df-btn df-ghost" onClick={exportCsv} disabled={visible.length === 0}>
            <I.Download size={13} /> Export
          </button>
          <button className="df-btn df-primary" onClick={() => setNewClientOpen(true)}>
            <I.Plus size={13} /> New client
          </button>
        </div>
      </div>

      <div className="df-section">
        <div className="df-section-head">
          <div className="df-seg" role="tablist">
            <button className={filter === 'all' ? 'df-active' : ''} onClick={() => setFilter('all')}>
              All <span className="df-mono" style={{ opacity: 0.6 }}>{counts.all}</span>
            </button>
            <button className={filter === 'attention' ? 'df-active' : ''} onClick={() => setFilter('attention')}>
              Needs attention <span className="df-mono" style={{ opacity: 0.6 }}>{counts.attention}</span>
            </button>
            <button className={filter === 'no_access' ? 'df-active' : ''} onClick={() => setFilter('no_access')}>
              No portal access <span className="df-mono" style={{ opacity: 0.6 }}>{counts.noAccess}</span>
            </button>
          </div>
          <div className="df-right" style={{ gap: 6 }}>
            <input
              className="df-input df-sm"
              placeholder="Search name, email or account…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 240 }}
              aria-label="Search clients"
            />
            <select className="df-input df-sm" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort clients">
              {(Object.keys(SORT_LABEL) as Sort[]).map((s) => (
                <option key={s} value={s}>{SORT_LABEL[s]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="df-list">
          {isPending && <SkeletonRows rows={5} label="Loading clients" />}
          {error && !isPending && <LoadError what="your clients" onRetry={() => refetch()} />}
          {!isPending && !error && clients.length === 0 && (
            <div className="df-empty">No clients yet. “New client” adds one and hands you an invitation link.</div>
          )}
          {!isPending && !error && clients.length > 0 && visible.length === 0 && (
            <div className="df-empty">No client matches that.</div>
          )}

          {visible.map((c) => {
            const access = accessState(c);
            const pill = ACCESS_LABEL[access];
            return (
              <div
                key={c.id}
                className="df-row df-clickable"
                style={{ gridTemplateColumns: '36px 1fr auto auto', opacity: c.deactivatedAt ? 0.6 : 1 }}
                onClick={() => navigate(`/clients/${c.id}`)}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/clients/${c.id}`); }}
              >
                <div className="df-client-avatar" style={{ width: 32, height: 32, fontSize: 12, borderRadius: 8 }}>{initialsOf(c.name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="df-name">{c.name}</div>
                  <div className="df-meta">
                    {c.email} · <span className="df-mono">{c.accountId}</span> · {c.documentsCount} document{c.documentsCount === 1 ? '' : 's'} · active {formatRelative(c.lastActivity)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {access !== 'active' && <span className={'df-pill ' + pill.cls}>{pill.label}</span>}
                  {c.pendingUpdates > 0 && <span className="df-pill df-warn">{c.pendingUpdates} pending</span>}
                  {c.unreadMessages > 0 && <span className="df-pill df-accent">{c.unreadMessages} unread</span>}
                </div>
                <button className="df-btn df-ghost df-sm" onClick={(e) => { e.stopPropagation(); navigate(`/clients/${c.id}`); }}>
                  Open
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <NewClientDialog open={newClientOpen} onClose={() => setNewClientOpen(false)} onCreated={(c) => navigate(`/clients/${c.id}`)} />
    </div>
  );
};

export default Clients;
