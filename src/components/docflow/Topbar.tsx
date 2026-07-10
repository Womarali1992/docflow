import React, { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { I } from './icons';
import { useClients } from '@/context/ClientsContext';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { useAuth } from '@/context/AuthContext';
import SearchPalette from './SearchPalette';
import NotificationsPopover from './NotificationsPopover';
import RequestDocumentDialog from './RequestDocumentDialog';

interface TopbarProps {
  onMenuClick?: () => void;
}

const Topbar: React.FC<TopbarProps> = ({ onMenuClick }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const { clients, refresh: refreshClients } = useClients();
  const { documents, refresh: refreshDocs } = useDocumentsStore();
  const { logout } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  const crumbs: { label: string; muted?: boolean }[] = (() => {
    if (pathname === '/') return [{ label: 'Overview' }];
    if (pathname === '/overview') return [{ label: 'Calendar' }];
    if (pathname === '/settings') return [{ label: 'Settings' }];
    if (pathname === '/documents') return [{ label: 'Documents' }];
    if (pathname.startsWith('/clients')) {
      const id = params.clientId as string | undefined;
      const client = id ? clients.find(c => c.id === id) : undefined;
      return [{ label: 'Clients', muted: true }, { label: client?.name || 'Client' }];
    }
    if (pathname.startsWith('/documents/')) {
      const id = params.documentId as string | undefined;
      const doc = id ? documents.find(d => d.id === id) : undefined;
      return [{ label: 'Documents', muted: true }, { label: doc?.name || 'Document' }];
    }
    return [{ label: 'Not found' }];
  })();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshClients(), refreshDocs()]);
    } finally {
      setRefreshing(false);
    }
  };

  // Request target: the client currently in view, else the first client.
  const routeClientId = params.clientId as string | undefined;
  const requestClient = clients.find(c => c.id === routeClientId) || clients[0];

  return (
    <div className="df-topbar">
      <button className="df-icon-btn df-menu-btn" aria-label="Open menu" onClick={onMenuClick}>
        <I.Menu size={18} />
      </button>
      <div className="df-crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="df-sep">/</span>}
            <span className={c.muted ? '' : 'df-now'}>{c.label}</span>
          </React.Fragment>
        ))}
      </div>
      <div className="df-spacer" />
      <SearchPalette />
      <button className="df-icon-btn" aria-label="Refresh" onClick={handleRefresh} disabled={refreshing}>
        <I.Refresh size={16} className={refreshing ? 'df-spin' : undefined} />
      </button>
      <NotificationsPopover />
      <button className="df-btn" onClick={handleLogout} title="Sign out">Sign out</button>
      <button className="df-btn df-primary" disabled={!requestClient} onClick={() => setRequestOpen(true)}>
        <I.Plus size={13} /> New request
      </button>

      {requestClient && (
        <RequestDocumentDialog
          open={requestOpen}
          onClose={() => setRequestOpen(false)}
          clientId={requestClient.id}
          clientName={requestClient.name}
        />
      )}
    </div>
  );
};

export default Topbar;
