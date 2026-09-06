import React, { useRef, useState } from 'react';
import type { PortalStep } from '@/api/queries/portal';
import { useRespondToRequest, useUploadToRequest } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { I } from '../icons';
import Modal from '../Modal';
import AskDialog from './AskDialog';

/**
 * One thing the client still has to do.
 *
 * Three ways out of it, and the third is the one that matters: **I don't have
 * this**. Without it a client who genuinely has no brokerage account is stuck
 * looking at a line they cannot clear, and the accountant is left wondering
 * whether it is coming. Saying so is recorded as an answer — it does not take
 * the line off the list, because only the accountant can decide that.
 */

const BUCKET_PILL: Record<PortalStep['bucket'], { label: string; cls: string } | null> = {
  needs_correction: { label: 'Needs another look', cls: 'df-danger' },
  overdue: { label: 'Overdue', cls: 'df-danger' },
  due_soon: { label: 'Due soon', cls: 'df-warn' },
  open: null,
};

const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

const RequestCard: React.FC<{ step: PortalStep }> = ({ step }) => {
  const { request, engagement, answer } = step;
  const { toast } = useToast();
  const upload = useUploadToRequest();
  const respond = useRespondToRequest();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [askOpen, setAskOpen] = useState(false);
  const [naOpen, setNaOpen] = useState(false);
  const [naNote, setNaNote] = useState('');

  const pill = BUCKET_PILL[step.bucket];
  const alreadySaid = Boolean(request.clientResponseKind);
  const busy = upload.isPending || respond.isPending;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const result = await upload.mutateAsync({ id: request.id, file });
        toast({
          title: result.status === 202 ? 'Received — being checked' : 'Sent',
          description:
            result.status === 202
              ? `${file.name} is with your accountant. It becomes readable once the security check finishes.`
              : `${file.name} is with your accountant.`,
        });
      } catch (err) {
        toast({ title: `Could not send ${file.name}`, description: getErrorMessage(err), variant: 'destructive' });
      }
    }
  };

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
        {pill && <span className={'df-pill ' + pill.cls}>{pill.label}</span>}
      </div>

      {request.instructions && <div className="df-step-body">{request.instructions}</div>}

      {request.status === 'needs_correction' && (
        <div className="df-note df-note-warn">
          Your accountant has asked for a corrected copy. Their note is in the messages for this item.
        </div>
      )}
      {answer && request.status !== 'needs_correction' && (
        <div className="df-note">You sent {answer.displayName ?? answer.name}. Sending another replaces it.</div>
      )}
      {alreadySaid && (
        <div className="df-note">
          You have said you do not have this{request.clientResponseNote ? `: “${request.clientResponseNote}”` : ''}. Your
          accountant will decide whether it comes off the list.
        </div>
      )}

      <div className="df-step-actions">
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          style={{ display: 'none' }}
          onChange={(e) => { handleFiles(e.target.files); e.currentTarget.value = ''; }}
        />
        <button className="df-btn df-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
          <I.Upload size={13} /> {upload.isPending ? 'Sending…' : 'Upload'}
        </button>
        <button className="df-btn" onClick={() => setAskOpen(true)} disabled={busy}>
          <I.Msg size={13} /> Ask a question
        </button>
        {!alreadySaid && (
          <button className="df-btn df-ghost" onClick={() => setNaOpen(true)} disabled={busy}>
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
