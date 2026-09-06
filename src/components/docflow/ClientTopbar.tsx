import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { I } from './icons';
import { useAuth } from '@/context/AuthContext';
import NotificationsPopover from './NotificationsPopover';

interface ClientTopbarProps {
  onMenuClick?: () => void;
}

const TITLES: Record<string, string> = {
  '/portal': 'Your next steps',
  '/portal/requests': 'Everything asked for',
  '/portal/documents': 'My documents',
  '/portal/shared': 'Shared with me',
  '/portal/messages': 'Messages',
  '/portal/security': 'Security',
};

/**
 * The portal's top bar. Since C4.1 the portal is real routes, so this shows
 * where you are rather than driving the page underneath it — the global search
 * box and the upload button went with the single-page portal: uploading belongs
 * on the item being answered, not floating above everything.
 */
const ClientTopbar: React.FC<ClientTopbarProps> = ({ onMenuClick }) => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { logout, me } = useAuth();

  const title = TITLES[pathname] ?? 'Your portal';

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
        <span>{me?.kind === 'client' ? me.providerName || 'Your accountant' : 'Portal'}</span>
        <span className="df-sep">/</span>
        <span className="df-now">{title}</span>
      </div>
      <div className="df-spacer" />
      <NotificationsPopover />
      <button className="df-btn" onClick={handleLogout}>Sign out</button>
    </div>
  );
};

export default ClientTopbar;
