import React, { useRef, useState } from 'react';
import type { PortalStep } from '@/api/queries/portal';
import { useRespondToRequest } from '@/api/queries';
import { useUploadQueue } from '@/components/upload/useUploadQueue';
import UploadQueue from '@/components/upload/UploadQueue';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { I } from '../icons';
import Modal from '../Modal';
import AskDialog from './AskDialog';
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
 */

const BUCKET_PILL: Record<PortalStep['bucket'], { label: string; cls: string } | null> = {
  needs_correction: null, // the state pill already says it
  overdue: { label: 'Overdue', cls: 'df-danger' },
  due_soon: { label: 'Due soon', cls: 'df-warn' },
  open: null,
};

const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const RequestCard: React.FC<{ step: PortalStep }> = ({ step }) => {
  const { request, engagement, answer } = step;
  const { toast } = useToast();
  const respond = useRespondToRequest();
  const queue = useUploadQueue();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const [askOpen, setAskOpen] = useState(false);
  const [naOpen, setNaOpen] = useState(false);
  const [naNote, setNaNote] = useState('');

  const bucketPill = BUCKET_PILL[step.bucket];
  const status = clientRequestState(request, answer);
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
      {answer && status.state === 'waiting_on_you' && (
        <div className="df-note">You sent {answer.displayName ?? answer.name}. Sending another replaces it.</div>
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
          onChange={(e) => { if (e.target.files) queue.enqueue(e.target.files, { kind: 'request', id: request.id }); e.currentTarget.value = ''; }}
        />
        {/* On a phone this opens the camera; on a desktop the browser ignores
            `capture` and it behaves like any other file picker. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) queue.enqueue(e.target.files, { kind: 'request', id: request.id }); e.currentTarget.value = ''; }}
        />

        <button className="df-btn df-primary" onClick={() => fileRef.current?.click()}>
          <I.Upload size={13} /> {queue.busy ? 'Sending…' : 'Upload'}
        </button>
        <button className="df-btn df-camera-only" onClick={() => cameraRef.current?.click()}>
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

      <AskDialog open={askOpen} onClose={() => setAskOpen(false)} about={request.title} documentId={answer?.id} />

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
