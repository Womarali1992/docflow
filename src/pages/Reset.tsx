import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/api/client';
import { getErrorMessage } from '@/utils/errors';
import AuthShell, { ErrorPill } from '@/components/docflow/AuthShell';
import { NewPasswordFields } from '@/components/docflow/PasswordFields';
import { passwordsReady } from '@/utils/passwords';
import { I } from '@/components/docflow/icons';

/** Completes a reset link: new password, every device signed out, back to sign in. */
const Reset = () => {
  const { token = '' } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordsReady(password, confirm)) return;
    setError(null);
    setLoading(true);
    try {
      await api.auth.confirmPasswordReset(token, password);
      setDone(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell subtitle="Choose a new password">
      {done ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <div>Your password is changed and every device was signed out. Sign in with the new password.</div>
          <Link className="df-btn df-primary" to="/login" style={{ justifyContent: 'center' }}><I.Check size={13} /> Sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <NewPasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} disabled={loading} autoFocus />
          <ErrorPill message={error} />
          <button type="submit" className="df-btn df-primary" style={{ justifyContent: 'center', marginTop: 4 }} disabled={loading || !passwordsReady(password, confirm)}>
            {loading ? 'Saving…' : <><I.Check size={13} /> Change password</>}
          </button>
          <div className="df-muted" style={{ fontSize: 11.5 }}>
            Link not working? It lasts one hour and works once. <Link className="df-link" to="/forgot">Ask for a new one</Link>.
          </div>
        </form>
      )}
    </AuthShell>
  );
};

export default Reset;
