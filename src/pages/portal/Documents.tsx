import React, { useMemo, useRef, useState } from 'react';
import { useClientWork } from '@/api/queries/portal';
import { useUploadQueue } from '@/components/upload/useUploadQueue';
import UploadQueue from '@/components/upload/UploadQueue';
import type { Document } from '@/api/types';
import { I } from '@/components/docflow/icons';

/**
 * What the client has sent, grouped by the engagement it belongs to and the
 * year that engagement is for — which is how a person looks for last year's
 * bank statement.
 *
 * There is no download here on purpose: these are the client's own files going
 * out, and the copy that matters is the one still on their computer. What comes
 * *back* — the return, the letter — is under "Shared with you".
 *
 * "Send something else" exists for the file nobody asked for — a letter from
 * the tax office, a receipt the client thinks matters. It lands in their open
 * engagement, where the accountant will see it beside everything else, rather
 * than in a pile with no context. C4.2 gives it a real upload queue.
 */

const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

const formatBytes = (n?: number | null) => {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const PortalDocuments: React.FC = () => {
  const work = useClientWork();
  const queue = useUploadQueue();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');

  /* Where an unprompted file goes: the newest engagement still open. */
  const target = useMemo(
    () => [...work.engagements].filter((e) => e.status === 'open').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0],
    [work.engagements]
  );


  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? work.uploads.filter((d) => (d.displayName ?? d.name).toLowerCase().includes(q))
      : work.uploads;

    const byKey = new Map<string, { label: string; year: number; items: Document[] }>();
    for (const doc of list) {
      const engagement = work.engagements.find((e) => e.id === doc.engagementId);
      const label = engagement?.title ?? 'Sent outside an engagement';
      const year = engagement?.taxYear ?? doc.uploadedAt.getFullYear();
      const key = `${label}::${year}`;
      const group = byKey.get(key) ?? { label, year, items: [] };
      group.items.push(doc);
      byKey.set(key, group);
    }

    return [...byKey.values()]
      .map((g) => ({ ...g, items: [...g.items].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime()) }))
      .sort((a, b) => b.year - a.year || a.label.localeCompare(b.label));
  }, [work.uploads, work.engagements, query]);

  return (
    <div className="df-page">
      <div className="df-page-head">
        <div>
          <h1 className="df-client-name">My documents</h1>
          <div className="df-client-meta">
            <span>{work.uploads.length} file{work.uploads.length === 1 ? '' : 's'} you have sent</span>
          </div>
        </div>
        <div className="df-head-actions">
          <div className="df-search" style={{ maxWidth: 240 }}>
            <I.Search size={14} />
            <input placeholder="Search your files…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search your documents" />
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files && target) queue.enqueue(e.target.files, { kind: 'engagement', id: target.id }); e.currentTarget.value = ''; }}
          />
          <button
            className="df-btn df-primary"
            onClick={() => fileRef.current?.click()}
            disabled={!target}
            title={target ? undefined : 'Your accountant has not opened any work for you yet'}
          >
            <I.Upload size={13} /> {queue.busy ? 'Sending…' : 'Send something else'}
          </button>
        </div>
      </div>

      {queue.items.length > 0 && (
        <div className="df-section">
          <div className="df-section-body">
            <UploadQueue
              items={queue.items}
              onCancel={queue.cancel}
              onRetry={queue.retry}
              onRemove={queue.remove}
              onClearFinished={queue.clearFinished}
            />
          </div>
        </div>
      )}

      {work.isPending && <div className="df-section"><div className="df-empty">Loading…</div></div>}
      {!work.isPending && groups.length === 0 && (
        <div className="df-section">
          <div className="df-empty">
            {query ? 'Nothing matches that.' : 'You have not sent anything yet. Your next steps are on the home page.'}
          </div>
        </div>
      )}

      {groups.map((group) => (
        <div className="df-section" key={`${group.label}-${group.year}`}>
          <div className="df-section-head">
            <div>
              <div className="df-section-title">{group.label}</div>
              <div className="df-section-sub">
                <span className="df-mono">{group.year}</span> · {group.items.length} file{group.items.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <div className="df-list">
            {group.items.map((doc) => (
              <div key={doc.id} className="df-row" style={{ gridTemplateColumns: '1fr' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="df-name">{doc.displayName ?? doc.name}</div>
                  <div className="df-meta">Sent {formatDate(doc.uploadedAt)}{doc.sizeBytes ? ` · ${formatBytes(doc.sizeBytes)}` : ''}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default PortalDocuments;
