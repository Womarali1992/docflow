import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import type { Activity } from '@/api/types';
import { I } from './icons';

const SEEN_KEY = 'docflow:activities-seen';

const timeAgo = (d: Date) => {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const NotificationsPopover: React.FC = () => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Activity[]>([]);
  const [lastSeen, setLastSeen] = useState<number>(() => Number(localStorage.getItem(SEEN_KEY) || 0));
  const ref = useRef<HTMLDivElement>(null);

  const load = () => {
    api.activities.list({ limit: 8 }).then(setItems).catch(() => setItems([]));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const newest = items[0]?.createdAt ? items[0].createdAt.getTime() : 0;
  const hasUnseen = newest > lastSeen;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      load();
      const now = Date.now();
      localStorage.setItem(SEEN_KEY, String(now));
      setLastSeen(now);
    }
  };

  const targetFor = (a: Activity): string | null => {
    if ((a.type === 'document' || a.type === 'update') && a.targetId) return `/documents/${a.targetId}`;
    if (a.type === 'message' && a.clientId) return `/clients/${a.clientId}`;
    if (a.clientId) return `/clients/${a.clientId}`;
    return null;
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="df-icon-btn" aria-label="Notifications" onClick={toggle}>
        <I.Bell size={16} />
        {hasUnseen && <span className="df-dot" />}
      </button>
      {open && (
        <div className="df-popover">
          <div className="df-popover-head">Recent activity</div>
          <div className="df-popover-list">
            {items.length === 0 ? (
              <div className="df-empty" style={{ padding: 16 }}>No activity yet</div>
            ) : (
              items.map((a) => {
                const target = targetFor(a);
                return (
                  <div
                    key={a.id}
                    className={'df-popover-item' + (target ? ' df-clickable' : '')}
                    onClick={() => { if (target) { setOpen(false); navigate(target); } }}
                  >
                    <div className="df-popover-text"><strong>{a.actorName || 'Someone'}</strong> {a.description}</div>
                    <div className="df-popover-time">{timeAgo(a.createdAt)}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationsPopover;
