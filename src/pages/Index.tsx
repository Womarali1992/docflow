import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useClients } from '@/context/ClientsContext';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { useAuth } from '@/context/AuthContext';
import { downloadCsv } from '@/utils/csv';
import { I } from '@/components/docflow/icons';
import ActivityFeed from '@/components/docflow/ActivityFeed';
import NewClientDialog from '@/components/docflow/NewClientDialog';

const formatRelative = (d: Date | null) => {
  if (!d) return '—';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const fmtMoney = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

type Filter = 'all' | 'attention';

const Index = () => {
  const navigate = useNavigate();
  const { clients, loading: clientsLoading } = useClients();
  const { documents } = useDocumentsStore();
  const { me } = useAuth();
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const totals = useMemo(() => {
    const totalClients = clients.length;
    const totalDocs = documents.length;
    const totalPending = documents.filter(d => d.isRequested || d.hasUpdateRequest).length;
    const totalUnread = clients.reduce((s, c) => s + c.unreadMessages, 0);
    const hasAum = clients.some(c => c.aum != null);
    const totalAUM = clients.reduce((s, c) => s + (c.aum ?? 0), 0);
    return { totalClients, totalDocs, totalPending, totalUnread, hasAum, totalAUM };
  }, [clients, documents]);

  const headerName = me?.kind === 'provider' ? me.name : '';
  const firmName = me?.kind === 'provider' ? me.firmName : null;

  const needsAttention = (c: { pendingUpdates: number; unreadMessages: number }) =>
    c.pendingUpdates > 0 || c.unreadMessages > 0;

  const visibleClients = useMemo(() => {
    const list = filter === 'attention' ? clients.filter(needsAttention) : clients;
    return [...list].sort((a, b) => (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0));
  }, [clients, filter]);

  const exportCsv = () => {
    downloadCsv(
      'clients',
      ['Name', 'Email', 'Plan', 'AUM', 'Pending', 'Unread', 'Documents', 'Last activity'],
      clients.map(c => [
        c.name, c.email, c.plan || '', c.aum ?? '', c.pendingUpdates, c.unreadMessages, c.documentsCount,
        c.lastActivity ? c.lastActivity.toISOString() : '',
      ])
    );
  };

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Practice overview</h1>
          <div className="df-client-meta">
            <span>{headerName}{firmName ? `, ${firmName}` : ''}</span>
            <span className="df-dot-sep" />
            <span>{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>
        <div className="df-head-actions">
          <button className="df-btn df-ghost" onClick={exportCsv}><I.Download size={13} /> Export</button>
          <button className="df-btn df-primary" onClick={() => setNewClientOpen(true)}><I.Plus size={13} /> New client</button>
        </div>
      </div>

      <div className="df-kpi-strip">
        <div className="df-kpi">
          <div className="df-kpi-label">AUM · all clients</div>
          <div className="df-kpi-value df-mono">{totals.hasAum ? fmtMoney(totals.totalAUM) : '—'}</div>
          <div className="df-kpi-trend"><span className="df-muted">across {totals.totalClients} client{totals.totalClients !== 1 ? 's' : ''}</span></div>
        </div>
        <div className="df-kpi">
          <div className="df-kpi-label">Active clients</div>
          <div className="df-kpi-value df-mono">{totals.totalClients}</div>
          <div className="df-kpi-trend"><span className="df-muted">{clientsLoading ? 'loading…' : 'on file'}</span></div>
        </div>
        <div className="df-kpi">
          <div className="df-kpi-label">Pending review</div>
          <div className="df-kpi-value df-mono">{totals.totalPending}</div>
          <div className={'df-kpi-trend ' + (totals.totalPending > 0 ? 'df-warn' : '')}>
            {totals.totalPending > 0 ? 'Across all clients' : 'All clear'}
          </div>
        </div>
        <div className="df-kpi">
          <div className="df-kpi-label">Documents on file</div>
          <div className="df-kpi-value df-mono">{totals.totalDocs}</div>
          <div className="df-kpi-trend"><span className="df-muted">{totals.totalUnread} unread messages</span></div>
        </div>
      </div>

      <div className="df-grid-2-aside">
       <div className="df-section">
        <div className="df-section-head">
          <div>
            <div className="df-section-title">Clients</div>
            <div className="df-section-sub">{visibleClients.length} shown · sorted by recent activity</div>
          </div>
          <div className="df-right">
            <div className="df-seg">
              <button className={filter === 'all' ? 'df-active' : ''} onClick={() => setFilter('all')}>All</button>
              <button className={filter === 'attention' ? 'df-active' : ''} onClick={() => setFilter('attention')}>Needs attention</button>
            </div>
          </div>
        </div>
        <div className="df-list">
          {clientsLoading && clients.length === 0 && (
            <div className="df-empty">Loading clients…</div>
          )}
          {!clientsLoading && clients.length === 0 && (
            <div className="df-empty">No clients yet. Click “New client” to add one.</div>
          )}
          {!clientsLoading && clients.length > 0 && visibleClients.length === 0 && (
            <div className="df-empty">No clients need attention right now.</div>
          )}
          {visibleClients.map(c => {
            const initials = c.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
            return (
              <div
                key={c.id}
                className="df-row df-clickable"
                style={{ gridTemplateColumns: '36px 1fr auto auto auto' }}
                onClick={() => navigate(`/clients/${c.id}`)}
              >
                <div className="df-client-avatar" style={{ width: 32, height: 32, fontSize: 12, borderRadius: 8 }}>{initials}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="df-name">{c.name}</div>
                  <div className="df-meta">{c.email} · Active {formatRelative(c.lastActivity)}</div>
                </div>
                <div style={{ minWidth: 110, textAlign: 'right' }}>
                  <div className="df-mono" style={{ fontSize: 12.5, fontWeight: 500 }}>{c.aum != null ? fmtMoney(c.aum) : '—'}</div>
                  <div className="df-meta" style={{ marginTop: 0 }}>AUM</div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {c.pendingUpdates > 0 && <span className="df-pill df-warn">{c.pendingUpdates} pending</span>}
                  {c.unreadMessages > 0 && <span className="df-pill df-accent">{c.unreadMessages} unread</span>}
                </div>
                <button className="df-btn df-ghost df-sm" onClick={(e) => { e.stopPropagation(); navigate(`/clients/${c.id}`); }}>Open</button>
              </div>
            );
          })}
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

      <NewClientDialog
        open={newClientOpen}
        onClose={() => setNewClientOpen(false)}
        onCreated={(c) => navigate(`/clients/${c.id}`)}
      />
    </div>
  );
};

export default Index;
