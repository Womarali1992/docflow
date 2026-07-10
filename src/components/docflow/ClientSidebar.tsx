import React from 'react';
import { I } from './icons';
import { useClients } from '@/context/ClientsContext';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { useAuth } from '@/context/AuthContext';

const ClientSidebar: React.FC = () => {
  const { clients } = useClients();
  const { documents } = useDocumentsStore();
  const { me } = useAuth();

  const client = clients[0]; // for client login, ClientsContext returns just themselves
  const initials = client?.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() || '';

  const myDocs = documents.filter(d => !d.isRequested && d.folder !== 'Reports');
  const myRequests = documents.filter(d => d.isRequested);

  if (!client) {
    return (
      <aside className="df-sidebar">
        <div className="df-brand">
          <div className="df-brand-mark">D</div>
          <div>
            <div className="df-brand-name">DocFlow</div>
            <div className="df-brand-sub">Loading…</div>
          </div>
        </div>
      </aside>
    );
  }

  const scrollTo = (anchor?: string) => {
    if (!anchor) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const items: { id: string; label: string; Icon: typeof I.Folder; anchor?: string; count?: number }[] = [
    { id: 'home', label: 'Home',         Icon: I.Dashboard },
    { id: 'reqs', label: 'Requests',     Icon: I.Inbox, anchor: 'requests', count: myRequests.length },
    { id: 'docs', label: 'My documents', Icon: I.Folder, anchor: 'documents', count: myDocs.length },
    { id: 'msgs', label: 'Messages',     Icon: I.Msg, anchor: 'messages', count: client.unreadMessages },
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
      {items.map(it => {
        const IC = it.Icon;
        return (
          <div key={it.id} className="df-nav-item" onClick={() => scrollTo(it.anchor)}>
            <IC className="df-icon" />
            <span>{it.label}</span>
            {it.count !== undefined && it.count > 0 && <span className="df-count">{it.count}</span>}
          </div>
        );
      })}

      <div className="df-sidebar-foot">
        <div className="df-avatar">{initials}</div>
        <div style={{ minWidth: 0 }}>
          <div className="df-who">{me?.kind === 'client' ? me.name : client.name}</div>
          <div className="df-role">Client</div>
        </div>
      </div>
    </aside>
  );
};

export default ClientSidebar;
