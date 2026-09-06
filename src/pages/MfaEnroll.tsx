import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import type { MfaEnrollment } from '@/api/types';
import { useAuth } from '@/context/AuthContext';
import { getErrorMessage } from '@/utils/errors';
import AuthShell, { CodeInput, ErrorPill, RecoveryCodeList } from '@/components/docflow/AuthShell';
import { linkButtonStyle } from '@/components/docflow/authStyles';
import { I } from '@/components/docflow/icons';

/** Groups a base32 key in fours so it can be typed into an authenticator by hand. */
const groupKey = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

/**
 * Forced enrollment: scan the QR (or type the key), prove it works with one
 * code, save the recovery codes, continue. The session becomes active only
 * after the server accepted the code.
 */
const MfaEnroll = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { me, activate, logout } = useAuth();

  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const home = me?.kind === 'client' ? '/portal' : '/';
  const from = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    let cancelled = false;
    api.auth.mfa
      .enroll()
      .then((e) => { if (!cancelled) setEnrollment(e); })
      .catch((err) => { if (!cancelled) setSetupError(getErrorMessage(err)); });
    return () => { cancelled = true; };
  }, []);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.auth.mfa.confirmEnrollment(code);
      setRecoveryCodes(res.recoveryCodes);
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

  const finish = () => {
    activate();
    navigate(from || home, { replace: true });
  };

  const cancel = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (recoveryCodes) {
    return (
      <AuthShell subtitle="Save your recovery codes" width={460}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13 }}>
            Two-step verification is on. If you lose your phone, one of these codes signs you in instead.
            <strong> They are shown only once.</strong> Keep them somewhere safe, not in your email.
          </div>
          <RecoveryCodeList codes={recoveryCodes} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I saved these codes
          </label>
          <button type="button" className="df-btn df-primary" style={{ justifyContent: 'center' }} disabled={!saved} onClick={finish}>
            <I.Check size={13} /> Continue to DocFlow
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle="Set up two-step verification" width={460}>
      <form onSubmit={confirm} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13 }}>
          <strong>{me?.email}</strong> needs an authenticator app (Google Authenticator, Microsoft Authenticator,
          1Password, Authy…). Scan the code with it, then enter the 6-digit code it shows.
        </div>

        {setupError && <ErrorPill message={setupError} />}

        {enrollment ? (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <img
              src={enrollment.qrDataUrl}
              alt="QR code for your authenticator app"
              width={168}
              height={168}
              style={{ border: '1px solid var(--df-border)', borderRadius: 8, background: '#fff', padding: 6, flex: '0 0 auto' }}
            />
            <div style={{ flex: '1 1 180px', minWidth: 0, fontSize: 12 }}>
              <div className="df-muted" style={{ fontSize: 11.5 }}>Can't scan? Enter this key by hand</div>
              <div className="df-mono" style={{ fontSize: 13, letterSpacing: 1, marginTop: 4, wordBreak: 'break-all', userSelect: 'all' }}>
                {groupKey(enrollment.secret)}
              </div>
              <div className="df-muted" style={{ marginTop: 8, fontSize: 11.5 }}>
                Account: {enrollment.issuer} ({enrollment.account}) · time-based, 6 digits, 30 s
              </div>
            </div>
          </div>
        ) : (
          !setupError && <div className="df-muted" style={{ fontSize: 12.5 }}>Preparing your setup code…</div>
        )}

        <CodeInput value={code} onChange={setCode} label="Code from the app" disabled={!enrollment || loading} />

        <ErrorPill message={error} />

        <button type="submit" className="df-btn df-primary" style={{ justifyContent: 'center' }} disabled={!enrollment || loading}>
          {loading ? 'Checking…' : <><I.Shield size={13} /> Turn on two-step verification</>}
        </button>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="df-link df-muted" onClick={cancel} style={linkButtonStyle}>
            Cancel and sign out
          </button>
        </div>
      </form>
    </AuthShell>
  );
};

export default MfaEnroll;
