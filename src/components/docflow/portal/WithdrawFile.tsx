import React, { useState } from 'react';
import type { RequestAttachment, RequestItem } from '@/api/types';
import { useWithdrawDocument } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import Modal from '../Modal';

/**
 * "I sent the wrong file" (2026-10-28 audit).
 *
 * A client can take a file back until their accountant has accepted it or
 * asked for a correction on it; after that it is part of the decision and
 * stays. The server archives it, never deletes it, and tells the accountant.
 * Taking it back is not something the client can undo, hence the question.
 */
export const WithdrawDialog: React.FC<{
  file: RequestAttachment | null;
  /** True when this is the line's only file, so the line goes back to waiting on them. */
  lastOne: boolean;
  onClose: () => void;
}> = ({ file, lastOne, onClose }) => {
  const { toast } = useToast();
  const withdraw = useWithdrawDocument();

  const confirm = async () => {
    if (!file) return;
    try {
      await withdraw.mutateAsync(file.documentId);
      toast({ title: 'File withdrawn', description: `${file.displayName} will not be reviewed.` });
      onClose();
    } catch (err) {
      toast({ title: 'Could not withdraw that file', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <Modal
      open={file !== null}
      onClose={onClose}
      title="Withdraw this file?"
      subtitle={file?.displayName}
      footer={
        <>
          <button className="df-btn df-ghost" onClick={onClose} disabled={withdraw.isPending}>Keep it</button>
          <button className="df-btn df-primary" onClick={confirm} disabled={withdraw.isPending}>
            {withdraw.isPending ? 'Withdrawing…' : 'Withdraw'}
          </button>
        </>
      }
    >
      <div className="df-small">
        Your accountant will not review it. It stays on record with them, and they are told you withdrew it.
        {lastOne ? ' This item goes back to waiting for a file from you.' : ''}
      </div>
    </Modal>
  );
};

/** The files on a sent line that can still be taken back, each with its own Withdraw. */
export const WithdrawableFiles: React.FC<{ request: RequestItem }> = ({ request }) => {
  const [file, setFile] = useState<RequestAttachment | null>(null);
  const open = request.attachments.filter((a) => !a.decided);
  if (open.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {open.map((a) => (
        <button key={a.documentId} className="df-btn df-sm df-ghost" onClick={() => setFile(a)} title={`Take back ${a.displayName}`}>
          Withdraw {open.length > 1 || request.attachments.length > 1 ? a.displayName : 'file'}
        </button>
      ))}
      <WithdrawDialog file={file} lastOne={request.attachments.length === 1} onClose={() => setFile(null)} />
    </div>
  );
};
