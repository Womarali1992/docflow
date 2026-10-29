import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import type { AuthState } from '@/api/types';
import { useAuth } from '@/context/AuthContext';
import { getErrorMessage } from '@/utils/errors';
import { stagePath } from '@/utils/stage';
import AuthShell, { ErrorPill } from '@/components/docflow/AuthShell';
import { NewPasswordFields } from '@/components/docflow/PasswordFields';
import { passwordsReady } from '@/utils/passwords';
import { I } from '@/components/docflow/icons';

/** What the page needs from either kind of invitation, before the password is set. */
interface InviteView {
  intro: React.ReactNode;
  email: string;
  expiresAt: Date;
}

/** The two kinds of link that land here: a client joining the portal, an advisor joining the firm (F4). */
const KINDS = {
  client: {
    load: async (token: string): Promise<InviteView> => {
      const i = await api.invitations.get(token);
      return {
        intro: <><strong>{i.providerName}</strong>{i.firmName ? ` of ${i.firmName}` : ''} invited you to share documents securely.</>,
        email: i.email,
        expiresAt: i.expiresAt,
      };
    },
    accept: (token: string, password: string): Promise<AuthState> => api.invitations.accept(token, password),
    home: '/portal',
    askFor: 'ask your advisor for a new invitation link',
  },
  staff: {
    load: async (token: string): Promise<InviteView> => {
      const i = await api.staffInvitations.get(token);
      return {
        intro: <>{i.inviterName ? <><strong>{i.inviterName}</strong> invited you</> : 'You are invited'} to join <strong>{i.firmName}</strong> on DocFlow.</>,
        email: i.email,
        expiresAt: i.expiresAt,
      };
    },
    accept: (token: string, password: string): Promise<AuthState> => api.staffInvitations.accept(token, password),
    home: '/',
    askFor: 'ask the firm’s owner for a new invitation link',
  },
} as const;

/** A first sign-in: the link is the credential, the password is set here, MFA enrollment follows. */
const Invite: React.FC<{ kind?: keyof typeof KINDS }> = ({ kind = 'client' }) => {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { adopt } = useAuth();
  const flow = KINDS[kind];

  const [info, setInfo] = useState<InviteView | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    flow
      .load(token)
      .then((i) => { if (!cancelled) setInfo(i); })
      .catch((err) => { if (!cancelled) setLinkError(getErrorMessage(err)); });
    return () => { cancelled = true; };
  }, [token, flow]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordsReady(password, confirm)) return;
    setError(null);
    setLoading(true);
    try {
      const state = await flow.accept(token, password);
      adopt(state);
      navigate(stagePath(state.stage) || flow.home, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        setLinkError(getErrorMessage(err));
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  if (linkError) {
    return (
      <AuthShell subtitle="Invitation">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <ErrorPill message={linkError} />
          <div className="df-muted" style={{ fontSize: 12.5 }}>
            Already set a password? <Link className="df-link" to="/login">Sign in</Link>. Otherwise {flow.askFor}.
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle="Welcome to DocFlow">
      {info ? (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13 }}>
            {info.intro} You will sign in as <strong>{info.email}</strong>. Choose a password to get started; two-step verification comes next.
          </div>
          <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} disabled={loading} autoFocus label="Password" />
          <ErrorPill message={error} />
          <button type="submit" className="df-btn df-primary" style={{ justifyContent: 'center', marginTop: 4 }} disabled={loading || !passwordsReady(password, confirm)}>
            {loading ? 'Setting up…' : <><I.Check size={13} /> Set password and continue</>}
          </button>
          <div className="df-muted" style={{ fontSize: 11.5 }}>
            This link works once and expires {info.expiresAt.toLocaleDateString(undefined, { dateStyle: 'medium' })}.
          </div>
        </form>
      ) : (
        <div className="df-muted" style={{ fontSize: 12.5 }}>Checking your invitation…</div>
      )}
    </AuthShell>
  );
};

export default Invite;
