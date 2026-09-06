import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { I } from './icons';
import { useClients } from '@/api/queries';
import { useAuth } from '@/context/AuthContext';

/**
 * The workspace nav. Five destinations, because five is what the work is:
 * the queue, the people, their files, the checklists you reuse, your account.
 *
 * Calendar and Reports are gone — they pointed at the same documents list with
 * a folder filter, which is not a place. The financial overview is still
 * reachable at /overview until the pilot decides its fate (C5.4).
 */
const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: clients = [] } = useClients();
  const { me } = useAuth();

  const isActive = (id: string): boolean => {
    if (id === 'overview') return pathname === '/' || pathname.startsWith('/work');
    if (id === 'clients') return pathname.startsWith('/clients') || pathname.startsWith('/engagements');
    if (id === 'docs') return pathname.startsWith('/documents');
    if (id === 'templates') return pathname.startsWith('/templates');
    if (id === 'settings') return pathname.startsWith('/settings');
    return false;
  };

  const top = [
    { id: 'overview', label: 'Overview', Icon: I.Dashboard, to: '/' },
    { id: 'clients', label: 'Clients', Icon: I.Users, to: '/clients', count: clients.length || undefined },
    { id: 'docs', label: 'Documents', Icon: I.Folder, to: '/documents' },
    { id: 'templates', label: 'Templates', Icon: I.Inbox, to: '/templates' },
  ];
  const bottom = [{ id: 'settings', label: 'Settings', Icon: I.Settings, to: '/settings' }];

  const providerName = me?.kind === 'provider' ? me.name : '';
  const initials = providerName
    ? providerName.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()
    : '—';

  const renderItem = (it: { id: string; label: string; Icon: typeof I.Users; to: string; count?: number }) => {
    const IC = it.Icon;
    return (
      <div
        key={it.id}
        className={'df-nav-item' + (isActive(it.id) ? ' df-active' : '')}
        onClick={() => navigate(it.to)}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') navigate(it.to); }}
      >
        <IC className="df-icon" />
        <span>{it.label}</span>
        {it.count !== undefined && <span className="df-count">{it.count}</span>}
      </div>
    );
  };

  return (
    <aside className="df-sidebar">
      <div className="df-brand">
        <div className="df-brand-mark">D</div>
        <div>
          <div className="df-brand-name">DocFlow</div>
          <div className="df-brand-sub">CPA · v3.2</div>
        </div>
      </div>

      <div className="df-nav-section">Workspace</div>
      {top.map(renderItem)}

      <div className="df-nav-section">Account</div>
      {bottom.map(renderItem)}

      <div className="df-sidebar-foot">
        <div className="df-avatar">{initials}</div>
        <div style={{ minWidth: 0 }}>
          <div className="df-who">{providerName || 'Advisor'}</div>
          <div className="df-role">{me?.kind === 'provider' ? me.firmName || 'Principal CPA' : 'Principal CPA'}</div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
