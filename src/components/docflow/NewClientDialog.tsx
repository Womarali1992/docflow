import React, { useState } from 'react';
import Modal from './Modal';
import { I } from './icons';
import { api } from '@/api/client';
import { useClients } from '@/context/ClientsContext';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import type { Client } from '@/api/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (client: Client) => void;
}

const NewClientDialog: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const { refresh } = useClients();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState('Core');
  const [aum, setAum] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => { setName(''); setEmail(''); setPlan('Core'); setAum(''); setPassword(''); };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    if (!name.trim() || !email.trim() || busy) return;
    setBusy(true);
    try {
      const created = await api.clients.create({
        name: name.trim(),
        email: email.trim(),
        plan: plan.trim() || 'Core',
        aum: aum.trim() ? Number(aum) : null,
        password: password.trim() ? password.trim() : undefined,
      });
      await refresh();
      toast({ title: 'Client created', description: `${created.name} was added.` });
      onCreated?.(created);
      close();
    } catch (e) {
      toast({ title: 'Could not create client', description: getErrorMessage(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = name.trim() && email.trim() && (!aum.trim() || !Number.isNaN(Number(aum))) && (!password || password.length >= 6);

  return (
    <Modal
      open={open}
      onClose={close}
      title="New client"
      subtitle="Add a client to your book"
      footer={
        <>
          <button className="df-btn df-ghost" onClick={close}>Cancel</button>
          <button className="df-btn df-primary" disabled={!canSubmit || busy} onClick={submit}>
            <I.Plus size={12} /> Create client
          </button>
        </>
      }
    >
      <div className="df-form">
        <label className="df-field">
          <span className="df-field-label">Full name</span>
          <input className="df-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoFocus />
        </label>
        <label className="df-field">
          <span className="df-field-label">Email</span>
          <input className="df-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
        </label>
        <div className="df-form-row">
          <label className="df-field">
            <span className="df-field-label">Plan</span>
            <select className="df-input" value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="Core">Core</option>
              <option value="Wealth Tier">Wealth Tier</option>
            </select>
          </label>
          <label className="df-field">
            <span className="df-field-label">AUM <span className="df-muted">(optional)</span></span>
            <input className="df-input" inputMode="decimal" value={aum} onChange={(e) => setAum(e.target.value)} placeholder="e.g. 1500000" />
          </label>
        </div>
        <label className="df-field">
          <span className="df-field-label">Portal password <span className="df-muted">(optional · min 6 chars)</span></span>
          <input className="df-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Let them log into the client portal" />
        </label>
      </div>
    </Modal>
  );
};

export default NewClientDialog;
