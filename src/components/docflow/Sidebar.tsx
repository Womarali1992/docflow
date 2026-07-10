import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { I } from './icons';
import { useClients } from '@/context/ClientsContext';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { useAuth } from '@/context/AuthContext';

const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { clients } = useClients();
  const { documents } = useDocumentsStore();
  const { me } = useAuth();

  const docsCount = documents.length;
  const firstClientId = clients[0]?.id;
  const folderParam = new URLSearchParams(search).get('folder');

  const isActive = (id: string): boolean => {
    if (id === 'overview') return pathname === '/';
    if (id === 'clients') return pathname.startsWith('/clients');
    if (id === 'docs') return pathname.startsWith('/documents') && folderParam !== 'Reports';
    if (id === 'reports') return pathname.startsWith('/documents') && folderParam === 'Reports';
    if (id === 'cal') return pathname === '/overview';
    if (id === 'settings') return pathname === '/settings';
    return false;
  };

  const top = [
    { id: 'overview', label: 'Overview',  Icon: I.Dashboard, to: '/' },
    { id: 'clients',  label: 'Clients',   Icon: I.Users,    to: firstClientId ? `/clients/${firstClientId}` : '/', count: clients.length },
    { id: 'docs',     label: 'Documents', Icon: I.Folder,   to: '/documents', count: docsCount },
    { id: 'cal',      label: 'Calendar',  Icon: I.Calendar, to: '/overview' },
    { id: 'reports',  label: 'Reports',   Icon: I.Chart,    to: '/documents?folder=Reports' },
  ];
  const bottom = [
    { id: 'settings', label: 'Settings', Icon: I.Settings, to: '/settings' },
  ];

  const providerName = me?.kind === 'provider' ? me.name : '';
  const initials = providerName
    ? providerName.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : '—';

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
      {top.map(it => {
        const IC = it.Icon;
        return (
          <div
            key={it.id}
            className={'df-nav-item' + (isActive(it.id) ? ' df-active' : '')}
            onClick={() => navigate(it.to)}
          >
            <IC className="df-icon" />
            <span>{it.label}</span>
            {it.count !== undefined && <span className="df-count">{it.count}</span>}
          </div>
        );
      })}

      <div className="df-nav-section">Account</div>
      {bottom.map(it => {
        const IC = it.Icon;
        return (
          <div
            key={it.id}
            className={'df-nav-item' + (isActive(it.id) ? ' df-active' : '')}
            onClick={() => navigate(it.to)}
          >
            <IC className="df-icon" />
            <span>{it.label}</span>
          </div>
        );
      })}

      <div className="df-sidebar-foot">
        <div className="df-avatar">{initials}</div>
        <div style={{ minWidth: 0 }}>
          <div className="df-who">{providerName || 'Advisor'}</div>
          <div className="df-role">
            {me?.kind === 'provider' ? (me.firmName || 'Principal CPA') : 'Principal CPA'}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
