import React, { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { I } from './icons';
import { useClient, useEngagement } from '@/api/queries';
import { useAuth } from '@/context/AuthContext';
import SearchPalette from './SearchPalette';
import NotificationsPopover from './NotificationsPopover';

interface TopbarProps {
  onMenuClick?: () => void;
}

/**
 * Breadcrumbs, search, refresh, sign out.
 *
 * "New request" used to live here and created a bare requested-document row
 * outside any engagement — the exact shape C2.1 replaced. Requests now belong
 * to a checklist, so they are added where the checklist is.
 */
const Topbar: React.FC<TopbarProps> = ({ onMenuClick }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const clientId = params.clientId as string | undefined;
  const engagementId = params.engagementId as string | undefined;
  const { data: client } = useClient(clientId);
  const { data: engagement } = useEngagement(engagementId);

  const crumbs: { label: string; to?: string; muted?: boolean }[] = (() => {
    if (pathname === '/') return [{ label: 'Overview' }];
    if (pathname === '/overview') return [{ label: 'Financial overview' }];
    if (pathname.startsWith('/settings')) return [{ label: 'Settings' }];
    if (pathname.startsWith('/templates')) return [{ label: 'Templates' }];
    if (pathname === '/clients') return [{ label: 'Clients' }];
    if (pathname.startsWith('/clients/')) {
      return [{ label: 'Clients', to: '/clients', muted: true }, { label: client?.name || 'Client' }];
    }
    if (pathname.startsWith('/engagements/')) {
      const c = engagement?.engagement.clientId;
      return [
        { label: 'Clients', to: '/clients', muted: true },
        ...(c ? [{ label: client?.name || 'Client', to: `/clients/${c}`, muted: true }] : []),
        { label: engagement?.engagement.title || 'Engagement' },
      ];
    }
    if (pathname === '/documents') return [{ label: 'Documents' }];
    if (pathname.startsWith('/documents/')) {
      return [{ label: 'Documents', to: '/documents', muted: true }, { label: 'Document' }];
    }
    return [{ label: 'Not found' }];
  })();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  /** Everything on screen comes from the cache, so a refresh is an invalidation. */
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="df-topbar">
      <button className="df-icon-btn df-menu-btn" aria-label="Open menu" onClick={onMenuClick}>
        <I.Menu size={18} />
      </button>
      <div className="df-crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="df-sep">/</span>}
            {c.to ? (
              <button className="df-link" onClick={() => navigate(c.to!)}>{c.label}</button>
            ) : (
              <span className={c.muted ? '' : 'df-now'}>{c.label}</span>
            )}
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
    </div>
  );
};

export default Topbar;
