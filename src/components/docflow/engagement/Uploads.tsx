import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { EngagementDocument, RequestItem } from '@/api/types';
import { I } from '../icons';

interface Props {
  documents: EngagementDocument[];
  requests: RequestItem[];
}

const formatBytes = (n?: number | null) => {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const SCAN_NOTE: Record<string, string> = {
  pending: 'Still being checked — it cannot be opened yet.',
  error: 'The virus check has not completed. It will retry on its own; the file stays unreadable until it passes.',
  infected: 'The virus scanner found something in this file. It will never be served.',
  encrypted: 'This file is password-protected, so it could not be checked.',
};

/**
 * Everything the client has sent into this engagement — the answers to the
 * checklist and anything they added on their own.
 *
 * A file that has not passed the scanner is shown, and shown as unreadable:
 * hiding it would leave the advisor wondering whether the client ever sent it.
 */
const Uploads: React.FC<Props> = ({ documents, requests }) => {
  const navigate = useNavigate();
  const requestTitle = new Map(requests.map((r) => [r.id, r.title]));

  return (
    <div className="df-section">
      <div className="df-section-head">
        <div>
          <div className="df-section-title">Client uploads</div>
          <div className="df-section-sub">{documents.length} file{documents.length === 1 ? '' : 's'} in this engagement</div>
        </div>
      </div>

      <div className="df-list">
        {documents.length === 0 && <div className="df-empty">Nothing from the client yet.</div>}
        {documents.map((doc) => {
          const version = doc.currentVersion;
          const note = version && version.scanStatus !== 'clean' ? SCAN_NOTE[version.scanStatus] : null;
          return (
            <div
              key={doc.id}
              className="df-row df-clickable"
              style={{ gridTemplateColumns: '1fr auto auto', alignItems: 'center' }}
              onClick={() => navigate(`/documents/${doc.id}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/documents/${doc.id}`); }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="df-name">{doc.displayName ?? doc.name}</div>
                <div className="df-meta">
                  {doc.requestId && requestTitle.has(doc.requestId) ? <>for “{requestTitle.get(doc.requestId)}” · </> : null}
                  {version ? <>v{version.versionNo} · {formatBytes(version.sizeBytes)} · </> : null}
                  {doc.uploadedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                {note && <div className="df-note df-note-warn">{note}</div>}
              </div>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {version?.available === false && <span className="df-pill df-warn">Not readable</span>}
                {doc.archivedAt && <span className="df-pill df-plain">Archived</span>}
              </div>
              <button className="df-btn df-sm df-ghost" onClick={(e) => { e.stopPropagation(); navigate(`/documents/${doc.id}`); }}>
                <I.Doc size={12} /> Open
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Uploads;
