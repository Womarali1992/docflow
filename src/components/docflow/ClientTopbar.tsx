import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { I } from './icons';
import { useClient } from '@/api/queries';
import { useAuth } from '@/context/AuthContext';

interface ClientTopbarProps {
  onMenuClick?: () => void;
}

/** Fired by the Upload button; ClientPortal listens and opens its file picker
 *  synchronously so the browser keeps the user-gesture that allows the dialog. */
export const CLIENT_UPLOAD_EVENT = 'docflow:client-upload';

const ClientTopbar: React.FC<ClientTopbarProps> = ({ onMenuClick }) => {
  const navigate = useNavigate();
  const { logout, me } = useAuth();
  const { data: client } = useClient(me?.kind === 'client' ? me.id : undefined);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');

  // Debounce search into ?q= so ClientPortal can filter its document groups.
  useEffect(() => {
    const t = setTimeout(() => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (q) next.set('q', q); else next.delete('q');
        return next;
      }, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [q, setParams]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="df-topbar">
      <button className="df-icon-btn df-menu-btn" aria-label="Open menu" onClick={onMenuClick}>
        <I.Menu size={18} />
      </button>
      <div className="df-crumbs">
        <span className="df-now">My portal</span>
        <span className="df-sep">/</span>
        <span>{client?.name || ''}</span>
      </div>
      <div className="df-spacer" />
      <div className="df-search">
        <I.Search size={14} />
        <input placeholder="Search my documents…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <button className="df-btn" onClick={handleLogout}>Sign out</button>
      <button className="df-btn df-primary" onClick={() => window.dispatchEvent(new CustomEvent(CLIENT_UPLOAD_EVENT))}>
        <I.Upload size={13} /> Upload
      </button>
    </div>
  );
};

export default ClientTopbar;
