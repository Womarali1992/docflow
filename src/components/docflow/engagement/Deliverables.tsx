import React, { useRef, useState } from 'react';
import { api } from '@/api/client';
import type { EngagementDocument } from '@/api/types';
import { useShareDocument, useUnshareDocument, useUploadToEngagement } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { I } from '../icons';
import Modal from '../Modal';

interface Props {
  engagementId: string;
  closed: boolean;
  documents: EngagementDocument[];
}

const formatBytes = (n?: number | null) => {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * The advisor's own material: the return, the letter, the summary.
 *
 * A deliverable is **private until it is shared** — the client gets a 404 for
 * it, not a "forbidden", so an unshared draft does not even announce itself.
 * Sharing is therefore a deliberate, confirmed act with its own audit line, and
 * unsharing is offered next to it because a wrong file sent to a client is the
 * mistake this screen exists to make recoverable.
 */
const Deliverables: React.FC<Props> = ({ engagementId, closed, documents }) => {
  const { toast } = useToast();
  const upload = useUploadToEngagement();
  const share = useShareDocument();
  const unshare = useUnshareDocument();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [confirmShare, setConfirmShare] = useState<EngagementDocument | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const result = await upload.mutateAsync({ engagementId, file });
        toast({
          title: result.status === 202 ? 'Uploaded — being checked' : 'Deliverable uploaded',
          description:
            result.status === 202
              ? `${file.name} is stored and will appear once the virus check finishes. It is not shared yet.`
              : `${file.name} is on file, private until you share it.`,
        });
      } catch (err) {
        toast({ title: `Could not upload ${file.name}`, description: getErrorMessage(err), variant: 'destructive' });
      }
    }
  };

  const doShare = async (doc: EngagementDocument) => {
    try {
      await share.mutateAsync(doc.id);
      setConfirmShare(null);
      toast({ title: 'Shared with the client', description: `${doc.displayName ?? doc.name} is now visible in their portal.` });
    } catch (err) {
      toast({ title: 'Could not share', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const doUnshare = async (doc: EngagementDocument) => {
    try {
      await unshare.mutateAsync(doc.id);
      toast({ title: 'No longer shared', description: `${doc.displayName ?? doc.name} is private again.` });
    } catch (err) {
      toast({ title: 'Could not unshare', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <div className="df-section">
      <div className="df-section-head">
        <div>
          <div className="df-section-title">Deliverables</div>
          <div className="df-section-sub">Your material — private until you share it</div>
        </div>
        <div className="df-right">
          <input
            ref={fileRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => { handleFiles(e.target.files); e.currentTarget.value = ''; }}
          />
          <button className="df-btn df-sm df-primary" onClick={() => fileRef.current?.click()} disabled={closed || upload.isPending}>
            <I.Upload size={12} /> {upload.isPending ? 'Uploading…' : 'Upload deliverable'}
          </button>
        </div>
      </div>

      <div className="df-list">
        {closed && <div className="df-note">This engagement is closed. Reopen it to add deliverables.</div>}
        {documents.length === 0 && (
          <div className="df-empty">Nothing here yet. Upload the return, letter or summary when it is ready.</div>
        )}
        {documents.map((doc) => {
          const version = doc.currentVersion;
          const readable = version?.available ?? false;
          return (
            <div key={doc.id} className="df-row" style={{ gridTemplateColumns: '1fr auto auto', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div className="df-name">{doc.displayName ?? doc.name}</div>
                <div className="df-meta">
                  {version ? (
                    <>v{version.versionNo} · {formatBytes(version.sizeBytes)} · {doc.uploadedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                  ) : (
                    'No file yet'
                  )}
                </div>
                {version && !readable && (
                  <div className="df-note df-note-warn">
                    {version.scanStatus === 'infected'
                      ? 'The virus scanner found something in this file. It will not be served — upload a clean copy.'
                      : 'Still being checked. It cannot be shared or downloaded until the scan finishes.'}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {doc.shared ? <span className="df-pill df-ok">Shared</span> : <span className="df-pill df-plain">Private</span>}
              </div>

              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {readable && (
                  <a className="df-btn df-sm df-ghost" href={api.documents.downloadUrl(doc.id, { attachment: true })}>
                    <I.Download size={12} /> Download
                  </a>
                )}
                {doc.shared ? (
                  <button className="df-btn df-sm df-ghost" onClick={() => doUnshare(doc)} disabled={unshare.isPending}>
                    Unshare
                  </button>
                ) : (
                  <button
                    className="df-btn df-sm df-primary"
                    onClick={() => setConfirmShare(doc)}
                    disabled={!readable || share.isPending}
                    title={readable ? undefined : 'Wait for the virus check to finish'}
                  >
                    <I.Send size={12} /> Share
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        open={Boolean(confirmShare)}
        onClose={() => setConfirmShare(null)}
        title="Share with the client?"
        subtitle={confirmShare ? (confirmShare.displayName ?? confirmShare.name) : undefined}
        footer={
          <>
            <button className="df-btn df-ghost" onClick={() => setConfirmShare(null)} disabled={share.isPending}>Keep private</button>
            <button className="df-btn df-primary" onClick={() => confirmShare && doShare(confirmShare)} disabled={share.isPending}>
              {share.isPending ? 'Sharing…' : 'Share it'}
            </button>
          </>
        }
      >
        <div style={{ fontSize: 13 }}>
          The client sees this in their portal straight away and can download it. You can unshare it later, but they may
          already have opened it.
        </div>
      </Modal>
    </div>
  );
};

export default Deliverables;
