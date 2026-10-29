import React, { useState } from 'react';
import Modal from './Modal';
import LinkModal, { type OneTimeLinkView } from './LinkModal';
import { staffInvitationHint } from './linkHints';
import { I } from './icons';
import {
  activeAdvisors,
  useDeactivateAdvisor,
  useFirm,
  useInviteAdvisor,
  useReactivateAdvisor,
  useResendAdvisorInvite,
} from '@/api/queries';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import type { Advisor } from '@/api/types';

const when = (d: Date) => d.toLocaleDateString(undefined, { dateStyle: 'medium' });

/** Where an advisor's account stands, in one pill. */
function state(a: Advisor): { label: string; tone: string } {
  if (a.deactivatedAt) return { label: 'Deactivated', tone: 'df-danger' };
  if (!a.hasPassword) return a.invitePendingUntil ? { label: 'Invited', tone: 'df-info' } : { label: 'Link expired', tone: 'df-warn' };
  return { label: 'Active', tone: 'df-ok' };
}

/**
 * "Your firm" in Settings (FIRM-BOOK-PLAN F4): who shares the book, and, for an
 * owner, inviting another advisor and deactivating or reactivating one. An
 * invitation is a copy-link, like a client's; deactivating asks who takes over
 * their clients, and "nobody" leaves those clients for the whole firm to hear.
 */
const FirmCard: React.FC = () => {
  const { me } = useAuth();
  const { toast } = useToast();
  const { data: firm, error } = useFirm();
  const invite = useInviteAdvisor();
  const resend = useResendAdvisorInvite();
  const deactivate = useDeactivateAdvisor();
  const reactivate = useReactivateAdvisor();

  const isOwner = me?.kind === 'provider' && me.role === 'owner';
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState<OneTimeLinkView | null>(null);
  const [leaving, setLeaving] = useState<Advisor | null>(null);
  const [reassignTo, setReassignTo] = useState('');

  const closeInvite = () => { setInviting(false); setName(''); setEmail(''); };

  const sendInvite = async () => {
    if (!name.trim() || !email.trim() || invite.isPending) return;
    try {
      const r = await invite.mutateAsync({ name: name.trim(), email: email.trim() });
      closeInvite();
      setLink({ title: `Invite ${r.advisor.name}`, link: r.link, expiresAt: r.expiresAt, hint: staffInvitationHint(r.emailQueued) });
    } catch (e) {
      toast({ title: 'Could not invite this advisor', description: getErrorMessage(e), variant: 'destructive' });
    }
  };

  const resendFor = async (a: Advisor) => {
    try {
      const r = await resend.mutateAsync(a.id);
      setLink({ title: `Invite ${a.name}`, link: r.link, expiresAt: r.expiresAt, hint: staffInvitationHint(r.emailQueued) });
    } catch (e) {
      toast({ title: 'Could not make a new link', description: getErrorMessage(e), variant: 'destructive' });
    }
  };

  const confirmDeactivate = async () => {
    if (!leaving) return;
    try {
      const r = await deactivate.mutateAsync({ id: leaving.id, reassignTo: reassignTo || null });
      toast({
        title: `${leaving.name} is deactivated`,
        description: r.clientsMoved === 0 ? 'They had no clients to hand on.' : `${r.clientsMoved} client${r.clientsMoved === 1 ? '' : 's'} moved.`,
      });
      setLeaving(null);
    } catch (e) {
      toast({ title: 'Could not deactivate', description: getErrorMessage(e), variant: 'destructive' });
    }
  };

  const reactivateFor = async (a: Advisor) => {
    try {
      await reactivate.mutateAsync(a.id);
      toast({ title: `${a.name} can sign in again`, description: 'Give them clients from each client’s page.' });
    } catch (e) {
      toast({ title: 'Could not reactivate', description: getErrorMessage(e), variant: 'destructive' });
    }
  };

  const takers = activeAdvisors(firm).filter((a) => a.id !== leaving?.id);
  const advisors = firm?.advisors ?? [];

  return (
    <div className="df-section">
      <div className="df-section-head">
        <div>
          <div className="df-section-title">Your firm</div>
          <div className="df-section-sub">
            {firm ? `${firm.name} · ${advisors.length} advisor${advisors.length === 1 ? '' : 's'} sharing one client book` : 'The advisors who share your client book'}
          </div>
        </div>
        {isOwner && (
          <div className="df-right">
            <button className="df-btn df-sm" onClick={() => setInviting(true)}>
              <I.Plus size={12} /> Invite an advisor
            </button>
          </div>
        )}
      </div>
      <div className="df-section-body">
        <div className="df-list">
          {!firm && !error && <div className="df-empty">Loading…</div>}
          {error && <div className="df-empty">{getErrorMessage(error)}</div>}
          {advisors.map((a) => {
            const s = state(a);
            const self = a.id === me?.id;
            return (
              <div key={a.id} className="df-row" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
                <div>
                  <div className="df-name" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {a.name}
                    {self && <span className="df-pill df-plain">You</span>}
                    <span className="df-pill df-plain">{a.role === 'owner' ? 'Owner' : 'Advisor'}</span>
                    <span className={`df-pill ${s.tone}`}>{s.label}</span>
                  </div>
                  <div className="df-meta">
                    {a.email} · {a.assignedClients} client{a.assignedClients === 1 ? '' : 's'}
                    {!a.hasPassword && a.invitePendingUntil && !a.deactivatedAt ? ` · link valid until ${when(a.invitePendingUntil)}` : ''}
                  </div>
                </div>
                {isOwner && !self && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {!a.deactivatedAt && !a.hasPassword && (
                      <button className="df-btn df-sm" disabled={resend.isPending} onClick={() => resendFor(a)}>New link</button>
                    )}
                    {a.deactivatedAt ? (
                      <button className="df-btn df-sm" disabled={reactivate.isPending} onClick={() => reactivateFor(a)}>Reactivate</button>
                    ) : (
                      <button className="df-btn df-sm df-ghost" onClick={() => { setLeaving(a); setReassignTo(''); }}>Deactivate</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!isOwner && firm && (
          <div className="df-muted" style={{ fontSize: 11.5, marginTop: 6 }}>An owner of the firm invites and deactivates advisors.</div>
        )}
      </div>

      <Modal
        open={inviting}
        onClose={closeInvite}
        title="Invite an advisor"
        subtitle="They share the firm's client book and choose their own password from the link"
        footer={
          <>
            <button className="df-btn df-ghost" onClick={closeInvite}>Cancel</button>
            <button className="df-btn df-primary" disabled={!name.trim() || !email.trim() || invite.isPending} onClick={sendInvite}>
              <I.Plus size={12} /> {invite.isPending ? 'Inviting…' : 'Invite'}
            </button>
          </>
        }
      >
        <div className="df-form">
          <label className="df-field">
            <span className="df-field-label">Full name</span>
            <input className="df-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="James Okafor" autoFocus />
          </label>
          <label className="df-field">
            <span className="df-field-label">Email</span>
            <input className="df-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="james@yourfirm.com" />
          </label>
        </div>
      </Modal>

      <Modal
        open={!!leaving}
        onClose={() => setLeaving(null)}
        title={leaving ? `Deactivate ${leaving.name}?` : ''}
        subtitle="They are signed out everywhere and cannot sign in until reactivated. Nothing they did is removed."
        footer={
          <>
            <button className="df-btn df-ghost" onClick={() => setLeaving(null)}>Cancel</button>
            <button className="df-btn df-primary" disabled={deactivate.isPending} onClick={confirmDeactivate}>
              {deactivate.isPending ? 'Deactivating…' : 'Deactivate'}
            </button>
          </>
        }
      >
        {leaving && (
          <div className="df-form">
            {leaving.assignedClients > 0 ? (
              <label className="df-field">
                <span className="df-field-label">
                  Move their {leaving.assignedClients} client{leaving.assignedClients === 1 ? '' : 's'} to
                </span>
                <select className="df-input" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                  <option value="">Nobody yet: the whole firm hears from them</option>
                  {takers.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="df-muted" style={{ fontSize: 12.5 }}>They have no clients to hand on.</div>
            )}
          </div>
        )}
      </Modal>

      <LinkModal value={link} onClose={() => setLink(null)} />
    </div>
  );
};

export default FirmCard;
