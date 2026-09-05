import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { getErrorMessage } from '@/utils/errors';
import AuthShell, { ErrorPill } from '@/components/docflow/AuthShell';
import { I } from '@/components/docflow/icons';

/** Asks for a reset. The answer is the same whether or not the account exists. */
const Forgot = () => {
  const [kind, setKind] = useState<'provider' | 'client'>('client');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.auth.requestPasswordReset(email.trim(), kind);
      setSent(true);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell subtitle="Reset your password">
      {sent ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <div>
            If there is an account for <strong>{email.trim()}</strong>, a reset link is on its way and stays valid for one hour.
          </div>
          <div className="df-muted" style={{ fontSize: 12.5 }}>
            Nothing arriving? Not every firm has email delivery switched on yet. {kind === 'client' ? 'Your advisor' : 'Your administrator'} can hand you a reset link directly.
          </div>
          <Link className="df-btn" to="/login" style={{ justifyContent: 'center' }}>Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="df-seg" style={{ display: 'flex' }}>
            <button type="button" className={kind === 'provider' ? 'df-active' : ''} onClick={() => setKind('provider')} style={{ flex: 1 }}>Advisor</button>
            <button type="button" className={kind === 'client' ? 'df-active' : ''} onClick={() => setKind('client')} style={{ flex: 1 }}>Client</button>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="df-muted" style={{ fontSize: 11.5 }}>Email</span>
            <input className="df-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus disabled={loading} />
          </label>
          <ErrorPill message={error} />
          <button type="submit" className="df-btn df-primary" style={{ justifyContent: 'center', marginTop: 4 }} disabled={loading}>
            {loading ? 'Sending…' : <><I.Send size={13} /> Send reset link</>}
          </button>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Link className="df-link" to="/login" style={{ fontSize: 11.5 }}>Back to sign in</Link>
          </div>
        </form>
      )}
    </AuthShell>
  );
};

export default Forgot;
