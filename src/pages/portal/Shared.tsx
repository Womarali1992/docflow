import React from 'react';
import { api } from '@/api/client';
import { useClientWork } from '@/api/queries/portal';
import { I } from '@/components/docflow/icons';

/**
 * What the accountant has shared back: the return, the letter, the summary.
 *
 * A deliverable only appears here once it has been shared — before that the
 * server does not admit it exists — so everything on this page is downloadable
 * by definition, and there is nothing to explain about drafts.
 */

const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const PortalShared: React.FC = () => {
  const work = useClientWork();

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">Shared with you</h1>
          <div className="df-client-meta">
            <span>{work.shared.length} document{work.shared.length === 1 ? '' : 's'} from your accountant</span>
          </div>
        </div>
      </div>

      <div className="df-section">
        <div className="df-list">
          {work.isPending && <div className="df-empty">Loading…</div>}
          {!work.isPending && work.shared.length === 0 && (
            <div className="df-empty">Nothing yet. Finished documents appear here as soon as your accountant shares them.</div>
          )}
          {work.shared.map((doc) => {
            const engagement = work.engagements.find((e) => e.id === doc.engagementId);
            return (
              <div key={doc.id} className="df-row" style={{ gridTemplateColumns: '1fr auto' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="df-name">{doc.displayName ?? doc.name}</div>
                  <div className="df-meta">
                    {engagement?.title ?? 'Your file'}
                    {doc.sharedAt ? ` · shared ${formatDate(doc.sharedAt)}` : ''}
                  </div>
                </div>
                <a className="df-btn df-sm df-primary" href={api.documents.downloadUrl(doc.id, { attachment: true })}>
                  <I.Download size={12} /> Download
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PortalShared;
