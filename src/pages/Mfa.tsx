import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { getErrorMessage } from '@/utils/errors';
import AuthShell, { CodeInput, ErrorPill } from '@/components/docflow/AuthShell';
import { linkButtonStyle } from '@/components/docflow/authStyles';
import { I } from '@/components/docflow/icons';

/** Second step of sign-in: the authenticator code, or one recovery code. */
const Mfa = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { me, activate, logout } = useAuth();

  const [mode, setMode] = useState<'code' | 'recovery'>('code');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const home = me?.kind === 'client' ? `/client/${me.id}` : '/';
  const from = (location.state as { from?: string } | null)?.from;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.auth.mfa.verify(mode === 'code' ? { code } : { recoveryCode });
      activate();
      if (mode === 'recovery') {
        // Hand the user straight to the security card when they are running low.
        if (res.recoveryCodesLeft <= 2 && me?.kind === 'provider') {
          navigate('/settings', { replace: true });
          return;
        }
      }
      navigate(from || home, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Wait 15 minutes and try again.');
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (next: 'code' | 'recovery') => {
    setMode(next);
    setError(null);
  };

  const cancel = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <AuthShell subtitle="Two-step verification">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13 }}>
          Signed in as <strong>{me?.email}</strong>.{' '}
          {mode === 'code'
            ? 'Enter the 6-digit code from your authenticator app.'
            : 'Enter one of the recovery codes you saved when you set up two-step verification. Each code works once.'}
        </div>

        {mode === 'code' ? (
          <CodeInput value={code} onChange={setCode} autoFocus disabled={loading} />
        ) : (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="df-muted" style={{ fontSize: 11.5 }}>Recovery code</span>
            <input
              className="df-input df-mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="ABCDE-FGH23"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase())}
              autoFocus
              disabled={loading}
              required
              style={{ fontSize: 16, letterSpacing: 2, textAlign: 'center' }}
            />
          </label>
        )}

        <ErrorPill message={error} />

        <button type="submit" className="df-btn df-primary" style={{ justifyContent: 'center', marginTop: 4 }} disabled={loading}>
          {loading ? 'Checking…' : <><I.Shield size={13} /> Continue</>}
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          {mode === 'code' ? (
            <button type="button" className="df-link" onClick={() => switchMode('recovery')} style={linkButtonStyle}>
              Use a recovery code instead
            </button>
          ) : (
            <button type="button" className="df-link" onClick={() => switchMode('code')} style={linkButtonStyle}>
              Use my authenticator app
            </button>
          )}
          <button type="button" className="df-link df-muted" onClick={cancel} style={linkButtonStyle}>
            Cancel and sign out
          </button>
        </div>
      </form>
    </AuthShell>
  );
};

export default Mfa;
