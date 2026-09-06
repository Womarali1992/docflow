import React, { useMemo } from 'react';
import { useClientWork } from '@/api/queries/portal';
import type { RequestItem, RequestStatus } from '@/api/types';
import RequestCard from '@/components/docflow/portal/RequestCard';

/**
 * Every item on the client's list, including the ones that are finished.
 *
 * The home page shows only what needs doing; this is the whole file, because
 * "what did they ask me for in March?" is a question a client asks in October,
 * and a waived line has to keep saying why it was waived.
 */

const STATUS_PILL: Record<RequestStatus, { label: string; cls: string }> = {
  requested: { label: 'Waiting on you', cls: 'df-warn' },
  submitted: { label: 'Being reviewed', cls: 'df-info' },
  in_review: { label: 'Being reviewed', cls: 'df-info' },
  needs_correction: { label: 'Needs another look', cls: 'df-danger' },
  accepted: { label: 'Accepted', cls: 'df-ok' },
  waived: { label: 'Not needed', cls: 'df-plain' },
};

const PortalRequests: React.FC = () => {
  const work = useClientWork();

  const byEngagement = useMemo(() => {
    const groups = new Map<string, { title: string; items: RequestItem[] }>();
    for (const request of work.requests) {
      const engagement = work.engagements.find((e) => e.id === request.engagementId);
      const key = request.engagementId;
      const group = groups.get(key) ?? { title: engagement?.title ?? 'Your file', items: [] };
      group.items.push(request);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      group.items.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    }
    return [...groups.values()];
  }, [work.requests, work.engagements]);

  const stepFor = (request: RequestItem) => work.steps.find((s) => s.request.id === request.id);

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Everything asked for</h1>
          <div className="df-client-meta">
            <span>{work.progress.done} of {work.progress.total} settled</span>
          </div>
        </div>
      </div>

      {work.isPending && <div className="df-section"><div className="df-empty">Loading…</div></div>}
      {!work.isPending && byEngagement.length === 0 && (
        <div className="df-section">
          <div className="df-empty">Nothing has been asked for yet.</div>
        </div>
      )}

      {byEngagement.map((group) => (
        <div className="df-section" key={group.title}>
          <div className="df-section-head">
            <div>
              <div className="df-section-title">{group.title}</div>
              <div className="df-section-sub">{group.items.length} item{group.items.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          <div className="df-section-body df-steps">
            {group.items.map((request) => {
              const step = stepFor(request);
              // An open item keeps its full card, with the three ways to answer it.
              if (step) return <RequestCard key={request.id} step={step} />;
              const pill = STATUS_PILL[request.status];
              return (
                <div key={request.id} className="df-row" style={{ gridTemplateColumns: '1fr auto' }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="df-name">{request.title}</div>
                    {request.status === 'waived' && request.waivedReason && (
                      <div className="df-meta">Not needed: {request.waivedReason}</div>
                    )}
                    {request.status !== 'waived' && request.instructions && (
                      <div className="df-meta">{request.instructions}</div>
                    )}
                  </div>
                  <span className={'df-pill ' + pill.cls}>{pill.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default PortalRequests;
