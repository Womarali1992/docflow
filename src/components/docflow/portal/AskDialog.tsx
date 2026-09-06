import React, { useEffect, useState } from 'react';
import { useSendMessage } from '@/api/queries';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import Modal from '../Modal';
import { I } from '../icons';

interface Props {
  open: boolean;
  onClose: () => void;
  /** The checklist line being asked about; quoted into the message. */
  about: string;
  /** When a file has already been sent, the question belongs on its thread. */
  documentId?: string;
}

/**
 * "Ask a question" from a checklist card.
 *
 * The question goes on the document's own thread once something has been
 * uploaded, and on the general thread before that — so an answer about the
 * bank statement is filed with the bank statement rather than scrolled past in
 * one long conversation. The item is quoted at the top because the accountant
 * reading it three days later has thirty of these.
 */
const AskDialog: React.FC<Props> = ({ open, onClose, about, documentId }) => {
  const { toast } = useToast();
  const send = useSendMessage(documentId ? { documentId } : {});
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) setText(`Re: ${about}\n\n`);
  }, [open, about]);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    try {
      await send.mutateAsync(body);
      onClose();
      toast({ title: 'Question sent', description: 'Your accountant will see it with this item.' });
    } catch (err) {
      toast({ title: 'Could not send', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ask your accountant"
      subtitle={about}
      width={480}
      footer={
        <>
          <button className="df-btn df-ghost" onClick={onClose} disabled={send.isPending}>Cancel</button>
          <button className="df-btn df-primary" onClick={submit} disabled={send.isPending || !text.trim()}>
            <I.Send size={12} /> {send.isPending ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      <div className="df-form">
        <label className="df-field">
          <span className="df-field-label">Your question</span>
          <textarea
            className="df-input"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <span className="df-small df-muted">Private between you and your accountant.</span>
        </label>
      </div>
    </Modal>
  );
};

export default AskDialog;
