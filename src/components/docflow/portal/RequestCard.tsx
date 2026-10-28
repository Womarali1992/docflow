import React, { useRef, useState } from 'react';
import type { PortalStep } from '@/api/queries/portal';
import type { RequestAttachment } from '@/api/types';
import { useRespondToRequest } from '@/api/queries';
import { useUploadQueue } from '@/components/upload/useUploadQueue';
import UploadQueue from '@/components/upload/UploadQueue';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { I } from '../icons';
import Modal from '../Modal';
import AskDialog from './AskDialog';
import { WithdrawDialog } from './WithdrawFile';
import { clientRequestState } from './requestState';

/**
 * One thing the client still has to do.
 *
 * Three ways out of it, and the third is the one that matters: **I don't have
 * this**. Without it a client who genuinely has no brokerage account is stuck
 * looking at a line they cannot clear, and the accountant is left wondering
 * whether it is coming. Saying so is recorded as an answer — it does not take
 * the line off the list, because only the accountant can decide that.
 *
 * Uploading goes through the queue (C4.2): several files at once, each with its
 * own progress, cancel and — when one is refused — its own sentence explaining
 * why, without losing the ones that worked.
 *
 * A file sent by mistake can be withdrawn until the accountant has ruled on it.
 * After that it is part of their decision, and Replace is the way to send a
 * better copy.
 */

const BUCKET_PILL: Record<PortalStep['bucket'], { label: string; cls: string } | null> = {
  needs_correction: null, // the state pill already says it
  overdue: { label: 'Overdue', cls: 'df-danger' },
  due_soon: { label: 'Due soon', cls: 'df-warn' },
  open: null,
};

const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/** How big a file is, for a line that has to say which one it means. */
const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const RequestCard: React.FC<{ step: PortalStep }> = ({ step }) => {
  const { request, engagement } = step;
  const attachments = request.attachments;
  const { toast } = useToast();
  const respond = useRespondToRequest();
  const [withdrawing, setWithdrawing] = useState<RequestAttachment | null>(null);
  const queue = useUploadQueue();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  /**
   * Which attachment the next chosen file replaces (H5). `null` means the next
   * file is *another* attachment — the default, and the whole point of the
   * change: sending a second receipt no longer silently overwrites the first.
   */
  const [replacing, setReplacing] = useState<RequestAttachment | null>(null);

  const [askOpen, setAskOpen] = useState(false);
  const [naOpen, setNaOpen] = useState(false);
  const [naNote, setNaNote] = useState('');

  const bucketPill = BUCKET_PILL[step.bucket];
  const refused = attachments.filter((a) => a.state === 'refused');
  const status = clientRequestState(request, attachments);

  /** Opens the picker with (or without) a replacement target set first. */
  const choose = (target: RequestAttachment | null, ref: React.RefObject<HTMLInputElement>) => {
    setReplacing(target);
    ref.current?.click();
  };

  const send = (files: FileList) =>
    queue.enqueue(files, { kind: 'request', id: request.id, replaceDocumentId: replacing?.documentId });
  const alreadySaid = Boolean(request.clientResponseKind);

  const sayNotApplicable = async () => {
    try {
      await respond.mutateAsync({ id: request.id, note: naNote.trim() || undefined });
      setNaOpen(false);
      setNaNote('');
      toast({
        title: 'Your accountant has been told',
        description: 'They will decide whether it can come off the list.',
      });
    } catch (err) {
      toast({ title: 'Could not send that', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <div className="df-step">
      <div className="df-step-head">
        <div style={{ minWidth: 0 }}>
          <div className="df-step-title">{request.title}</div>
          <div className="df-meta">
            {engagement?.title ?? 'Your file'}
            {request.dueDate ? <> · due {formatDate(request.dueDate)}</> : null}
            {!request.required ? ' · optional' : null}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {bucketPill && <span className={'df-pill ' + bucketPill.cls}>{bucketPill.label}</span>}
          <span className={'df-pill ' + status.cls}>{status.label}</span>
        </div>
      </div>

      {request.instructions && <div className="df-step-body">{request.instructions}</div>}

      {status.note && <div className={'df-note' + (status.state === 'needs_correction' ? ' df-note-warn' : '')}>{status.note}</div>}
      {attachments.length > 0 && (
        <div className="df-attachments">
          <div className="df-meta" style={{ marginBottom: 4 }}>
            You have sent {attachments.length} {attachments.length === 1 ? 'file' : 'files'} for this item
          </div>
          {attachments.map((attachment) => (
            <div className="df-attachment" key={attachment.documentId}>
              <I.Doc size={13} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="df-name">{attachment.displayName}</div>
                <div className="df-meta">
                  {attachment.currentVersion ? (
                    <>
                      {attachment.currentVersion.versionNo > 1
                        ? `Replaced ${attachment.currentVersion.versionNo - 1}×  · `
                        : ''}
                      {formatBytes(attachment.currentVersion.sizeBytes)}
                    </>
                  ) : null}
                </div>
              </div>
              {attachment.state === 'checking' ? (
                <span className="df-pill df-warn">Being checked</span>
              ) : attachment.state === 'refused' ? (
                <span className="df-pill df-danger">Not accepted</span>
              ) : (
                <span className="df-pill df-ok">Sent</span>
              )}
              <button
                className={'df-btn df-sm ' + (attachment.state === 'refused' ? 'df-primary' : 'df-ghost')}
                onClick={() => choose(attachment, fileRef)}
                title={`Send a corrected copy of ${attachment.displayName}`}
              >
                {attachment.state === 'refused' ? 'Send again' : 'Replace'}
              </button>
              {!attachment.decided && (
                <button
                  className="df-btn df-sm df-ghost"
                  onClick={() => setWithdrawing(attachment)}
                  title={`Take back ${attachment.displayName}`}
                >
                  Withdraw
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {refused.length > 0 && (
        <div className="df-note df-note-warn">
          {refused.length === 1
            ? `${refused[0].displayName} was not accepted: it did not pass the security check and was removed. Please send it again — from a different device if you can.`
            : `${refused.length} of your files were not accepted: they did not pass the security check and were removed. Please send them again — from a different device if you can.`}
        </div>
      )}
      {alreadySaid && (
        <div className="df-note">
          You have said you do not have this{request.clientResponseNote ? `: “${request.clientResponseNote}”` : ''}. Your
          accountant will decide whether it comes off the list.
        </div>
      )}

      <UploadQueue
        items={queue.items}
        onCancel={queue.cancel}
        onRetry={queue.retry}
        onRemove={queue.remove}
        onClearFinished={queue.clearFinished}
      />

      <div className="df-step-actions">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) send(e.target.files); e.currentTarget.value = ''; setReplacing(null); }}
        />
        {/* On a phone this opens the camera; on a desktop the browser ignores
            `capture` and it behaves like any other file picker. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) send(e.target.files); e.currentTarget.value = ''; setReplacing(null); }}
        />

        <button className="df-btn df-primary" onClick={() => choose(null, fileRef)}>
          <I.Upload size={13} />{' '}
          {queue.busy ? 'Sending…' : attachments.length > 0 ? 'Add another file' : 'Upload'}
        </button>
        <button className="df-btn df-camera-only" onClick={() => choose(null, cameraRef)}>
          <I.Doc size={13} /> Take a photo
        </button>
        <button className="df-btn" onClick={() => setAskOpen(true)}>
          <I.Msg size={13} /> Ask a question
        </button>
        {!alreadySaid && (
          <button className="df-btn df-ghost" onClick={() => setNaOpen(true)} disabled={respond.isPending}>
            I don’t have this
          </button>
        )}
      </div>

      <WithdrawDialog file={withdrawing} lastOne={attachments.length === 1} onClose={() => setWithdrawing(null)} />

      <AskDialog open={askOpen} onClose={() => setAskOpen(false)} about={request.title} documentId={attachments[0]?.documentId} />

      <Modal
        open={naOpen}
        onClose={() => setNaOpen(false)}
        title="Tell your accountant you don’t have this"
        subtitle={request.title}
        footer={
          <>
            <button className="df-btn df-ghost" onClick={() => setNaOpen(false)} disabled={respond.isPending}>Cancel</button>
            <button className="df-btn df-primary" onClick={sayNotApplicable} disabled={respond.isPending}>
              {respond.isPending ? 'Sending…' : 'Send'}
            </button>
          </>
        }
      >
        <div className="df-form">
          <div style={{ fontSize: 13 }}>
            This stays on your list until your accountant agrees it is not needed — they may come back and ask.
          </div>
          <label className="df-field">
            <span className="df-field-label">Anything they should know <span className="df-muted">(optional)</span></span>
            <textarea
              className="df-input"
              rows={3}
              value={naNote}
              onChange={(e) => setNaNote(e.target.value)}
              placeholder="I closed that account in March."
              autoFocus
            />
          </label>
        </div>
      </Modal>
    </div>
  );
};

export default RequestCard;
