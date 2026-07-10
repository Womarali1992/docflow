import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { I } from './icons';
import { api } from '@/api/client';
import type { Activity } from '@/api/types';

interface Props {
  clientId?: string;
  limit?: number;
  refreshKey?: number; // pass a counter to force refetch
  emptyMessage?: string;
  compact?: boolean; // narrower row layout for the home page sidebar
}

const TYPE_TO_ICON = {
  document: { type: 'up',  Icon: I.Upload },
  message:  { type: 'msg', Icon: I.Msg },
  update:   { type: 'req', Icon: I.Plus },
} as const;

const targetFor = (a: Activity): string | null => {
  if ((a.type === 'document' || a.type === 'update') && a.targetId) return `/documents/${a.targetId}`;
  if (a.type === 'message' && a.clientId) return `/clients/${a.clientId}`;
  return null;
};

const ActivityFeed: React.FC<Props> = ({ clientId, limit = 50, refreshKey, emptyMessage = 'No recent activity', compact = false }) => {
  const navigate = useNavigate();
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.activities
      .list({ clientId, limit })
      .then(list => { if (!cancelled) setItems(list); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, limit, refreshKey]);

  if (loading && items.length === 0) {
    return <div className="df-empty" style={{ padding: 24 }}>Loading activity…</div>;
  }
  if (items.length === 0) {
    return <div className="df-empty" style={{ padding: 24 }}>{emptyMessage}</div>;
  }

  return (
    <div className="df-activity">
      {items.map(r => {
        const m = TYPE_TO_ICON[r.type] || { type: 'ok' as const, Icon: I.Check };
        const IC = m.Icon;
        const date = r.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const time = r.createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        return compact ? (
          <div key={r.id} className="df-act-row" style={{ gridTemplateColumns: '70px 16px 1fr' }}>
            <div className="df-act-time">{date}</div>
            <div className={'df-act-icon df-' + m.type}><IC size={10} strokeWidth={2} /></div>
            <div className="df-act-actor">
              <strong>{r.actorName || 'Someone'}</strong> {r.description}
            </div>
          </div>
        ) : (
          <div key={r.id} className="df-act-row">
            <div className="df-act-time"><span style={{ color: 'var(--df-ink-2)' }}>{date}</span> · {time}</div>
            <div className={'df-act-icon df-' + m.type}><IC size={10} strokeWidth={2} /></div>
            <div className="df-act-actor">
              <strong>{r.actorName || 'Someone'}</strong> {r.description}
            </div>
            {(() => {
              const target = targetFor(r);
              return target ? <button className="df-btn df-ghost df-sm" onClick={() => navigate(target)}>View</button> : <span />;
            })()}
          </div>
        );
      })}
    </div>
  );
};

export default ActivityFeed;
