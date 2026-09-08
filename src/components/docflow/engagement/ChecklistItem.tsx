import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RequestItem, RequestStatus } from '@/api/types';
import { useAcceptRequest, useReopenRequest, useRequestCorrection, useUpdateRequest, useWaiveRequest } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { I } from '../icons';
import ReasonDialog from '../ReasonDialog';

/**
 * One checklist line, and every decision that can be made about it.
 *
 * The actions offered are the ones the server will accept in this state — there
 * is no "Accept" on a line nothing has been submitted against, because the
 * server answers that with `nothing_submitted` and a disabled-looking button
 * that fails is worse than no button. Waiving asks for a reason and correcting
 * asks for a note, because both are refused without one.
 */

const STATUS_PILL: Record<RequestStatus, { label: string; cls: string }> = {
  requested: { label: 'Requested', cls: 'df-warn' },
  submitted: { label: 'Submitted', cls: 'df-info' },
  in_review: { label: 'In review', cls: 'df-info' },
  needs_correction: { label: 'Needs correction', cls: 'df-danger' },
  accepted: { label: 'Accepted', cls: 'df-ok' },
  waived: { label: 'Waived', cls: 'df-plain' },
};

const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const toDateInput = (d: Date | null) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');

interface Props {
  request: RequestItem;
  first: boolean;
  last: boolean;
  editable: boolean;
  onMove: (direction: -1 | 1) => void;
}

const ChecklistItem: React.FC<Props> = ({ request, first, last, editable, onMove }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const updateRequest = useUpdateRequest();
  const accept = useAcceptRequest();
  const requestCorrection = useRequestCorrection();
  const waive = useWaiveRequest();
  const reopen = useReopenRequest();

  const [editing, setEditing] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [waiveOpen, setWaiveOpen] = useState(false);

  const [title, setTitle] = useState(request.title);
  const [instructions, setInstructions] = useState(request.instructions ?? '');
  const [category, setCategory] = useState(request.category ?? '');
  const [dueDate, setDueDate] = useState(toDateInput(request.dueDate));
  const [required, setRequired] = useState(request.required);

  const pill = STATUS_PILL[request.status];
  const answered = request.status === 'submitted' || request.status === 'in_review' || request.status === 'needs_correction';
  const settled = request.status === 'accepted' || request.status === 'waived';
  /* The client said "I don't have this" and nobody has decided yet. */
  const needsDecision = Boolean(request.clientResponseKind) && !settled;
  const busy = accept.isPending || requestCorrection.isPending || waive.isPending || reopen.isPending || updateRequest.isPending;

  /**
   * The files filed against this line (H5), and the decision they permit.
   *
   * A decision has to name every attachment's current version (invariant 19),
   * so it can only be made once all of them have been scanned — and until H5
   * these two buttons named *no* version at all, which the server has refused
   * with 400 `version_required` since H2. The review workspace was sending one
   * and this row was not, so the bug only showed up here.
   */
  const attachments = request.attachments;
  const versionIds = attachments.map((a) => a.currentVersion?.id).filter((id): id is string => Boolean(id));
  const stillChecking = attachments.some((a) => a.state === 'checking');
  const decidable = attachments.length > 0 && !stillChecking && versionIds.length === attachments.length;

  const startEdit = () => {
    setTitle(request.title);
    setInstructions(request.instructions ?? '');
    setCategory(request.category ?? '');
    setDueDate(toDateInput(request.dueDate));
    setRequired(request.required);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!title.trim()) return;
    try {
      await updateRequest.mutateAsync({
        id: request.id,
        patch: {
          title: title.trim(),
          instructions: instructions.trim() || null,
          category: category.trim() || null,
          required,
          dueDate: dueDate ? new Date(`${dueDate}T12:00:00`).toISOString() : null,
        },
      });
      setEditing(false);
    } catch (err) {
      toast({ title: 'Could not save the change', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const run = async (work: () => Promise<unknown>, failTitle: string) => {
    try {
      await work();
    } catch (err) {
      toast({ title: failTitle, description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  if (editing) {
    return (
      <div className="df-row" style={{ gridTemplateColumns: '1fr', gap: 8 }}>
        <div className="df-form">
          <label className="df-field">
            <span className="df-field-label">What you need</span>
            <input className="df-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </label>
          <label className="df-field">
            <span className="df-field-label">Instructions <span className="df-muted">(the client reads this)</span></span>
            <textarea className="df-input" rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </label>
          <div className="df-form-row">
            <label className="df-field">
              <span className="df-field-label">Category</span>
              <input className="df-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Income" />
            </label>
            <label className="df-field">
              <span className="df-field-label">Due date</span>
              <input className="df-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>
          <label className="df-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            <span className="df-field-label" style={{ margin: 0 }}>Required — the client is chased for it</span>
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="df-btn df-sm df-primary" onClick={saveEdit} disabled={busy || !title.trim()}>
              {updateRequest.isPending ? 'Saving…' : 'Save'}
            </button>
            <button className="df-btn df-sm df-ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="df-row" style={{ gridTemplateColumns: 'auto 1fr auto', alignItems: 'flex-start', gap: 10 }}>
      {editable ? (
        <div className="df-reorder">
          <button className="df-icon-btn df-sm" aria-label="Move up" disabled={first || busy} onClick={() => onMove(-1)}>
            <I.ArrowUp size={12} />
          </button>
          <button className="df-icon-btn df-sm" aria-label="Move down" disabled={last || busy} onClick={() => onMove(1)}>
            <I.ArrowUp size={12} style={{ transform: 'rotate(180deg)' }} />
          </button>
        </div>
      ) : (
        <span />
      )}

      <div style={{ minWidth: 0 }}>
        <div className="df-name">
          {request.title}
          {!request.required && <span className="df-pill df-plain" style={{ marginLeft: 8 }}>Optional</span>}
        </div>
        <div className="df-meta">
          {request.category ? <>{request.category} · </> : null}
          {request.dueDate ? <>due {formatDate(request.dueDate)}</> : 'no due date'}
          {attachments.length === 1 && attachments[0].currentVersion ? (
            <> · v{attachments[0].currentVersion.versionNo} {attachments[0].currentVersion.originalFilename}</>
          ) : attachments.length > 1 ? (
            <> · {attachments.length} files</>
          ) : null}
        </div>
        {request.instructions && <div className="df-small df-muted" style={{ marginTop: 4 }}>{request.instructions}</div>}

        {needsDecision && (
          <div className="df-note df-note-warn">
            <strong>The client says they do not have this.</strong>
            {request.clientResponseNote ? <> “{request.clientResponseNote}”</> : null}{' '}
            Waive it with a reason, or leave it on the list.
          </div>
        )}
        {request.status === 'waived' && request.waivedReason && (
          <div className="df-note">Waived: {request.waivedReason}</div>
        )}
        {stillChecking && (
          <div className="df-note df-note-warn">
            {attachments.length > 1
              ? 'Some of these files are still being checked. They become readable once the scan finishes.'
              : 'This upload is still being checked. It becomes readable once the scan finishes.'}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {request.overdue && <span className="df-pill df-danger">Overdue</span>}
          {needsDecision && <span className="df-pill df-warn">Needs decision</span>}
          <span className={'df-pill ' + pill.cls}>{pill.label}</span>
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {attachments.length > 0 && (
            <button
              className="df-btn df-sm df-ghost"
              onClick={() => navigate(`/review/${attachments[0].documentId}`)}
            >
              <I.Doc size={12} /> {attachments.length > 1 ? `Open ${attachments.length}` : 'Open'}
            </button>
          )}
          {answered && (
            <>
              <button
                className="df-btn df-sm df-primary"
                disabled={busy || !decidable}
                title={stillChecking ? 'Wait for the security check to finish' : undefined}
                onClick={() => run(() => accept.mutateAsync({ id: request.id, versionIds }), 'Could not accept')}
              >
                <I.Check size={12} /> Accept
              </button>
              <button
                className="df-btn df-sm"
                disabled={busy || !decidable}
                title={stillChecking ? 'Wait for the security check to finish' : undefined}
                onClick={() => setCorrectionOpen(true)}
              >
                Request correction
              </button>
            </>
          )}
          {!settled && (
            <button className="df-btn df-sm df-ghost" disabled={busy} onClick={() => setWaiveOpen(true)}>
              Waive
            </button>
          )}
          {settled && (
            <button
              className="df-btn df-sm df-ghost"
              disabled={busy}
              onClick={() => run(() => reopen.mutateAsync(request.id), 'Could not reopen')}
            >
              <I.Refresh size={12} /> Reopen
            </button>
          )}
          {editable && !settled && (
            <button className="df-btn df-sm df-ghost" disabled={busy} onClick={startEdit}>Edit</button>
          )}
        </div>
      </div>

      <ReasonDialog
        open={correctionOpen}
        onClose={() => setCorrectionOpen(false)}
        title="Ask for a correction"
        subtitle={request.title}
        label="What needs correcting?"
        help="The client sees this note. Say what is wrong and what to send instead."
        placeholder="The statement is missing page 2 — please send the full PDF."
        confirmLabel="Send back for correction"
        onConfirm={(note) => requestCorrection.mutateAsync({ id: request.id, note, versionIds })}
      />

      <ReasonDialog
        open={waiveOpen}
        onClose={() => setWaiveOpen(false)}
        title="Waive this item"
        subtitle={request.title}
        label="Why is this not needed?"
        help="This stays on the file. A year from now it has to answer “why isn’t this on the list?”."
        placeholder="Client had no brokerage account in 2026."
        confirmLabel="Waive item"
        onConfirm={(reason) => waive.mutateAsync({ id: request.id, reason })}
      />
    </div>
  );
};

export default ChecklistItem;
