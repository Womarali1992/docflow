import React, { useState } from 'react';
import Modal from './Modal';
import LinkModal, { type OneTimeLinkView } from './LinkModal';
import { invitationHint } from './linkHints';
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

/**
 * Creates the client record, then hands the advisor a one-time invitation
 * link: the client sets their own password and enrolls MFA from it. No
 * passwords are typed on the advisor's side.
 */
const NewClientDialog: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const { refresh } = useClients();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState('Core');
  const [aum, setAum] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Client | null>(null);
  const [invite, setInvite] = useState<OneTimeLinkView | null>(null);

  const reset = () => { setName(''); setEmail(''); setPlan('Core'); setAum(''); };
  const close = () => { reset(); onClose(); };

  const finish = () => {
    const c = created;
    setInvite(null);
    setCreated(null);
    close();
    if (c) onCreated?.(c);
  };

  const submit = async () => {
    if (!name.trim() || !email.trim() || busy) return;
    setBusy(true);
    try {
      const c = await api.clients.create({
        name: name.trim(),
        email: email.trim(),
        plan: plan.trim() || 'Core',
        aum: aum.trim() ? Number(aum) : null,
      });
      await refresh();
      toast({ title: 'Client created', description: `${c.name} was added.` });
      setCreated(c);
      try {
        const link = await api.clients.invite(c.id);
        await refresh();
        setInvite({
          title: `Invite ${c.name}`,
          link: link.link,
          expiresAt: link.expiresAt,
          hint: invitationHint(link.emailQueued, 'new-client'),
        });
      } catch (e) {
        toast({ title: 'Client created, but no invitation yet', description: getErrorMessage(e), variant: 'destructive' });
        setCreated(null);
        close();
        onCreated?.(c);
      }
    } catch (e) {
      toast({ title: 'Could not create client', description: getErrorMessage(e), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = name.trim() && email.trim() && (!aum.trim() || !Number.isNaN(Number(aum)));

  return (
    <>
      <Modal
        open={open && !invite}
        onClose={close}
        title="New client"
        subtitle="Add a client to your book, then invite them to the portal"
        footer={
          <>
            <button className="df-btn df-ghost" onClick={close}>Cancel</button>
            <button className="df-btn df-primary" disabled={!canSubmit || busy} onClick={submit}>
              <I.Plus size={12} /> {busy ? 'Creating…' : 'Create and invite'}
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
          <div className="df-muted" style={{ fontSize: 12 }}>
            The client chooses their own password from the invitation link; nothing to type here.
          </div>
        </div>
      </Modal>

      <LinkModal value={invite} onClose={finish} doneLabel="Open client" />
    </>
  );
};

export default NewClientDialog;
