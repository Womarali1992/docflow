import React from 'react';
import { api } from '@/api/client';
import type { VersionWithReviews } from '@/api/types';
import { I } from '../icons';

/**
 * Every version this document has had, and what was decided about each one.
 *
 * Versions are immutable — a replacement is a new row, never an overwrite — so
 * this list is the document's history rather than a log of edits. The decision
 * shown against a version is the decision made about *that* version: accepting
 * v2 does not retroactively accept v1, and a correction asked for on v1 stays
 * on the file after v2 arrives.
 */

const formatWhen = (d: Date) =>
  d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * One chip per version, saying what can be done with it rather than what the
 * scanner said. "Check failed" read like the *file* had failed; what it means
 * is that the scanner did not answer yet and the file is still on its way in,
 * which is the same thing a client sees as "received, checking".
 *
 * The four states a reader has to tell apart (H2): still arriving, the one to
 * decide about, an older one kept for the record, and one that will never be
 * served.
 */
const VERSION_PILL: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Received, checking', cls: 'df-warn' },
  error: { label: 'Received, checking', cls: 'df-warn' },
  encrypted: { label: 'Encrypted', cls: 'df-danger' },
  infected: { label: 'Quarantined', cls: 'df-danger' },
};

function pillFor(v: VersionWithReviews): { label: string; cls: string } {
  if (v.scanStatus !== 'clean') return VERSION_PILL[v.scanStatus] ?? VERSION_PILL.pending;
  return v.isCurrent ? { label: 'Ready for review', cls: 'df-ok' } : { label: 'Superseded', cls: 'df-plain' };
}

interface Props {
  documentId: string;
  versions: VersionWithReviews[];
  selectedId: string | null;
  onSelect: (versionId: string) => void;
}

const VersionHistory: React.FC<Props> = ({ documentId, versions, selectedId, onSelect }) => (
  <div className="df-section">
    <div className="df-section-head">
      <div>
        <div className="df-section-title">Versions</div>
        <div className="df-section-sub">{versions.length} on file · newest first</div>
      </div>
    </div>
    <div className="df-list">
      {versions.length === 0 && <div className="df-empty">No file has been uploaded yet.</div>}
      {versions.map((v) => {
        const pill = pillFor(v);
        // The server does not promise an order, and a version can carry more
        // than one decision (corrected, then accepted after a talk).
        const decision = [...v.reviews].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return (
          <div
            key={v.id}
            className={'df-row df-clickable' + (v.id === selectedId ? ' df-selected' : '')}
            style={{ gridTemplateColumns: '1fr auto', alignItems: 'flex-start' }}
            onClick={() => onSelect(v.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onSelect(v.id); }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="df-name">
                v{v.versionNo} · {v.originalFilename}
              </div>
              <div className="df-meta">
                {formatBytes(v.sizeBytes)} · {v.uploadedByKind === 'client' ? 'from the client' : 'from you'} · {formatWhen(v.createdAt)}
              </div>
              {decision && (
                <div className="df-note">
                  {decision.decision === 'accepted' ? 'Accepted' : 'Correction asked for'}
                  {decision.note ? <>: {decision.note}</> : null}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
              <span className={'df-pill ' + pill.cls}>{pill.label}</span>
              {v.available && (
                <a
                  className="df-btn df-sm df-ghost"
                  href={api.versions.downloadUrl(documentId, v.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Download version ${v.versionNo}`}
                >
                  <I.Download size={12} />
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

export default VersionHistory;
