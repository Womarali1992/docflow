import React, { useState } from 'react';
import { api } from '@/api/client';
import type { Client } from '@/api/types';
import { useClients } from '@/context/ClientsContext';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { ACCESS_LABEL, accessState } from '@/utils/clientAccess';
import LinkModal, { type OneTimeLinkView } from './LinkModal';
import { invitationHint, resetHint } from './linkHints';
import Modal from './Modal';
import { I } from './icons';

/**
 * Portal access controls for one client: the state pill, Invite / Resend,
 * a copy-link password reset, and deactivate / reactivate with a confirm.
 */
const ClientAccess: React.FC<{ client: Client }> = ({ client }) => {
  const { refresh } = useClients();
  const { toast } = useToast();
  const [link, setLink] = useState<OneTimeLinkView | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);

  const state = accessState(client);
  const pill = ACCESS_LABEL[state];

  const guard = async (work: () => Promise<void>, failTitle: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (err) {
      toast({ title: failTitle, description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const invite = () =>
    guard(async () => {
      const r = await api.clients.invite(client.id);
      setLink({
        title: state === 'invited' ? `New invitation for ${client.name}` : `Invite ${client.name}`,
        link: r.link,
        expiresAt: r.expiresAt,
        hint: invitationHint(r.emailQueued, 'client-page'),
      });
      await refresh();
    }, 'Could not create the invitation');

  const resetLink = () =>
    guard(async () => {
      const r = await api.clients.resetLink(client.id);
      setLink({
        title: `Password reset for ${client.name}`,
        link: r.link,
        expiresAt: r.expiresAt,
        hint: resetHint(r.emailQueued),
      });
    }, 'Could not create the reset link');

  const deactivate = () =>
    guard(async () => {
      await api.clients.deactivate(client.id);
      setConfirmOff(false);
      toast({ title: 'Client deactivated', description: `${client.name} is signed out and cannot sign in until reactivated.` });
      await refresh();
    }, 'Could not deactivate');

  const reactivate = () =>
    guard(async () => {
      await api.clients.reactivate(client.id);
      toast({ title: 'Client reactivated', description: `${client.name} can sign in again.` });
      await refresh();
    }, 'Could not reactivate');

  return (
    <>
      <span className={'df-pill ' + pill.cls} title="Portal access">{pill.label}</span>
      {state === 'deactivated' ? (
        <button className="df-btn" onClick={reactivate} disabled={busy}><I.Refresh size={13} /> Reactivate</button>
      ) : (
        <>
          {client.hasPassword ? (
            <button className="df-btn df-ghost" onClick={resetLink} disabled={busy} title="A one-hour link that lets the client set a new password">
              <I.Refresh size={13} /> Reset link
            </button>
          ) : (
            <button className="df-btn" onClick={invite} disabled={busy}>
              <I.Send size={13} /> {state === 'invited' ? 'Resend invite' : 'Invite'}
            </button>
          )}
          <button className="df-btn df-ghost" onClick={() => setConfirmOff(true)} disabled={busy}>Deactivate</button>
        </>
      )}

      <LinkModal value={link} onClose={() => setLink(null)} />

      <Modal
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title="Deactivate this client?"
        subtitle={client.name}
        footer={
          <>
            <button className="df-btn df-ghost" onClick={() => setConfirmOff(false)} disabled={busy}>Keep active</button>
            <button className="df-btn df-primary" onClick={deactivate} disabled={busy}>Deactivate</button>
          </>
        }
      >
        <div style={{ fontSize: 13 }}>
          They are signed out everywhere and cannot sign in until you reactivate them. Any pending invitation link stops working.
          Their documents, requests and messages stay exactly as they are.
        </div>
      </Modal>
    </>
  );
};

export default ClientAccess;
