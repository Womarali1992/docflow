import React from 'react';
import { NavLink } from 'react-router-dom';
import { I } from './icons';
import { useAuth } from '@/context/AuthContext';
import { useClient } from '@/api/queries';
import { useClientWork } from '@/api/queries/portal';

/**
 * The portal's navigation. Real routes since C4.1 — the old sidebar scrolled to
 * anchors on one long page, which meant a client could never link anyone to
 * "the thing I'm looking at" and the browser's back button did nothing.
 *
 * The counts are the ones that matter to a client: what is waiting on them, and
 * what has arrived for them.
 */
const ClientSidebar: React.FC = () => {
  const { me } = useAuth();
  const { data: client } = useClient(me?.kind === 'client' ? me.id : undefined);
  const work = useClientWork();

  const name = me?.name ?? client?.name ?? '';
  const initials = name ? name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase() : '—';

  const items: { to: string; label: string; Icon: typeof I.Folder; count?: number; end?: boolean }[] = [
    { to: '/portal', label: 'Your next steps', Icon: I.Dashboard, count: work.steps.length, end: true },
    { to: '/portal/requests', label: 'Everything asked for', Icon: I.Inbox, count: work.requests.length },
    { to: '/portal/documents', label: 'My documents', Icon: I.Folder, count: work.uploads.length },
    { to: '/portal/shared', label: 'Shared with me', Icon: I.Download, count: work.shared.length },
    { to: '/portal/messages', label: 'Messages', Icon: I.Msg, count: client?.unreadMessages },
    { to: '/portal/security', label: 'Security', Icon: I.Shield },
  ];

  return (
    <aside className="df-sidebar">
      <div className="df-brand">
        <div className="df-brand-mark">D</div>
        <div>
          <div className="df-brand-name">DocFlow</div>
          <div className="df-brand-sub">Client portal</div>
        </div>
      </div>

      <div className="df-nav-section">Portal</div>
      {items.map((it) => {
        const IC = it.Icon;
        return (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) => 'df-nav-item' + (isActive ? ' df-active' : '')}
          >
            <IC className="df-icon" />
            <span>{it.label}</span>
            {it.count !== undefined && it.count > 0 && <span className="df-count">{it.count}</span>}
          </NavLink>
        );
      })}

      <div className="df-sidebar-foot">
        <div className="df-avatar">{initials}</div>
        <div style={{ minWidth: 0 }}>
          <div className="df-who">{name || 'Client'}</div>
          <div className="df-role">Client</div>
        </div>
      </div>
    </aside>
  );
};

export default ClientSidebar;
