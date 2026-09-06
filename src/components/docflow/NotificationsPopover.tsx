import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarkNotificationsRead, useNotifications } from '@/api/queries';
import { I } from './icons';

/**
 * The bell.
 *
 * The count is the server's (invariant 15). It used to be "activities newer
 * than a timestamp in this browser's localStorage", which meant the badge was
 * wrong in the second tab, wrong on the phone, and cleared itself by being
 * looked at in the wrong place. Now `GET /notifications` says what is unread
 * and opening the list marks it read for this account, everywhere.
 *
 * It refreshes on the queue cadence (30 s), and those refreshes carry the poll
 * header — a bell in an open tab must not keep a session alive all day.
 */
const timeAgo = (d: Date) => {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const NotificationsPopover: React.FC = () => {
  const navigate = useNavigate();
  const { data } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const items = data?.notifications ?? [];
  const unread = data?.unread ?? 0;

  // Closes on a click outside *and* on Escape, and hands focus back to the
  // bell — a menu you can only leave with the mouse is a keyboard trap.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Opening the list is what "read" means; the server records it for every
    // device, so the badge cannot come back on the next reload.
    if (next && unread > 0) markRead.mutate(undefined);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        className="df-icon-btn"
        aria-label={unread > 0 ? `Notifications: ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
      >
        <I.Bell size={16} />
        {unread > 0 && <span className="df-dot" />}
      </button>
      {open && (
        <div className="df-popover" role="menu" aria-label="Notifications">
          <div className="df-popover-head">Notifications</div>
          <div className="df-popover-list">
            {items.length === 0 ? (
              <div className="df-empty" style={{ padding: 16 }}>Nothing yet</div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={'df-popover-item' + (n.link ? ' df-clickable' : '')}
                  role={n.link ? 'menuitem' : undefined}
                  tabIndex={n.link ? 0 : undefined}
                  onClick={() => { if (n.link) { setOpen(false); navigate(n.link); } }}
                  onKeyDown={(e) => { if (n.link && e.key === 'Enter') { setOpen(false); navigate(n.link); } }}
                >
                  <div className="df-popover-text">
                    <strong>{n.title}</strong>
                    {n.body ? <> {n.body}</> : null}
                  </div>
                  <div className="df-popover-time">{timeAgo(n.createdAt)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsPopover;
