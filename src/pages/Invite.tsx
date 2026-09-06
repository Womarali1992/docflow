import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import type { InvitationInfo } from '@/api/types';
import { useAuth } from '@/context/AuthContext';
import { getErrorMessage } from '@/utils/errors';
import { stagePath } from '@/utils/stage';
import AuthShell, { ErrorPill } from '@/components/docflow/AuthShell';
import { NewPasswordFields } from '@/components/docflow/PasswordFields';
import { passwordsReady } from '@/utils/passwords';
import { I } from '@/components/docflow/icons';

/** A client's first sign-in: the link is the credential, the password is set here, MFA enrollment follows. */
const Invite = () => {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { adopt } = useAuth();

  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.invitations
      .get(token)
      .then((i) => { if (!cancelled) setInfo(i); })
      .catch((err) => { if (!cancelled) setLinkError(getErrorMessage(err)); });
    return () => { cancelled = true; };
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordsReady(password, confirm)) return;
    setError(null);
    setLoading(true);
    try {
      const state = await api.invitations.accept(token, password);
      adopt(state);
      navigate(stagePath(state.stage) || '/portal', { replace: true });
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
            Already set a password? <Link className="df-link" to="/login">Sign in</Link>. Otherwise ask your advisor for a new invitation link.
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
            <strong>{info.providerName}</strong>{info.firmName ? ` of ${info.firmName}` : ''} invited you to share documents securely.
            You will sign in as <strong>{info.email}</strong>. Choose a password to get started; two-step verification comes next.
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
