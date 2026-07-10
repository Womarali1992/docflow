import React, { useState } from 'react';
import Modal from './Modal';
import { I } from './icons';
import { useDocumentsStore } from '@/context/DocumentsContext';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import type { RequestFrequency } from '@/api/types';

const FREQS: RequestFrequency[] = ['one-time', 'monthly', 'quarterly', 'yearly', 'daily'];

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName?: string;
}

const RequestDocumentDialog: React.FC<Props> = ({ open, onClose, clientId, clientName }) => {
  const { requestDocument } = useDocumentsStore();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [frequency, setFrequency] = useState<RequestFrequency>('one-time');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setName(''); setDescription(''); setFrequency('one-time'); setDueDate(''); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await requestDocument({
        documentName: name.trim(),
        description: description.trim() || undefined,
        clientId,
        frequency,
        dueDate: dueDate ? new Date(dueDate) : null,
      });
      toast({ title: 'Request sent', description: `Requested “${name.trim()}”${clientName ? ` from ${clientName}` : ''}.` });
      close();
    } catch (e) {
      toast({ title: 'Could not send request', description: getErrorMessage(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Request a document"
      subtitle={clientName ? `From ${clientName}` : undefined}
      footer={
        <>
          <button className="df-btn df-ghost" onClick={close}>Cancel</button>
          <button className="df-btn df-primary" disabled={!name.trim() || busy} onClick={submit}>
            <I.Plus size={12} /> Send request
          </button>
        </>
      }
    >
      <div className="df-form">
        <label className="df-field">
          <span className="df-field-label">Document name</span>
          <input className="df-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 2025 Tax Return" autoFocus />
        </label>
        <label className="df-field">
          <span className="df-field-label">Description <span className="df-muted">(optional)</span></span>
          <textarea className="df-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What exactly do you need?" />
        </label>
        <div className="df-form-row">
          <label className="df-field">
            <span className="df-field-label">Cadence</span>
            <select className="df-input" value={frequency} onChange={(e) => setFrequency(e.target.value as RequestFrequency)}>
              {FREQS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="df-field">
            <span className="df-field-label">Due date <span className="df-muted">(optional)</span></span>
            <input className="df-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>
      </div>
    </Modal>
  );
};

export default RequestDocumentDialog;
