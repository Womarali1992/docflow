import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import type { MfaStatus, SessionSummary } from '@/api/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/utils/errors';
import { CodeInput, ErrorPill, RecoveryCodeList } from './AuthShell';
import { NewPasswordFields } from './PasswordFields';
import { passwordsReady } from '@/utils/passwords';
import { I } from './icons';

const when = (d: Date) => d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "Chrome on Windows" from a user agent, or a trimmed fallback. */
function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua) ? 'Safari' : null;
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /iPhone|iPad/.test(ua) ? 'iOS' :
    /Android/.test(ua) ? 'Android' :
    /Mac OS/.test(ua) ? 'macOS' :
    /Linux/.test(ua) ? 'Linux' : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || ua.slice(0, 40);
}

/**
 * The account's security card: two-step verification status, recovery codes
 * (regenerate with a fresh code, shown once), the live sessions, and
 * "sign out everywhere". Shared by the advisor settings and the client portal.
 */
const SecurityCard: React.FC<{ id?: string }> = ({ id }) => {
  const navigate = useNavigate();
  const { logoutAll } = useAuth();
  const { toast } = useToast();

  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [regenerating, setRegenerating] = useState(false);
  const [code, setCode] = useState('');
  const [regenError, setRegenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const [changing, setChanging] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([api.auth.mfa.status(), api.auth.sessions()]);
      setStatus(s);
      setSessions(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const regenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegenError(null);
    setBusy(true);
    try {
      const res = await api.auth.mfa.regenerateRecoveryCodes(code);
      setNewCodes(res.recoveryCodes);
      setRegenerating(false);
      setCode('');
      await load();
    } catch (err) {
      setRegenError(err instanceof ApiError && err.status === 429 ? 'Too many attempts. Wait 15 minutes and try again.' : getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const resetChangeForm = () => {
    setChanging(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setChangeError(null);
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordsReady(newPassword, confirmPassword)) return;
    setChangeError(null);
    setChangeBusy(true);
    try {
      const { revoked } = await api.auth.changePassword({ currentPassword, newPassword });
      toast({
        title: 'Password changed',
        description: revoked > 0 ? `${revoked} other session${revoked === 1 ? '' : 's'} ended. This one stays signed in.` : 'This session stays signed in.',
      });
      resetChangeForm();
      await load();
    } catch (err) {
      setChangeError(getErrorMessage(err));
    } finally {
      setChangeBusy(false);
    }
  };

  const signOutEverywhere = async () => {
    try {
      const revoked = await logoutAll();
      toast({ title: 'Signed out everywhere', description: `${revoked} session${revoked === 1 ? '' : 's'} ended.` });
      navigate('/login', { replace: true });
    } catch (err) {
      toast({ title: 'Could not sign out', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const left = status?.recoveryCodesLeft ?? 0;
  const lowOnCodes = !!status?.enrolled && left <= 2;

  return (
    <div className="df-section" id={id}>
      <div className="df-section-head">
        <div>
          <div className="df-section-title">Security</div>
          <div className="df-section-sub">Two-step verification, recovery codes and where you are signed in</div>
        </div>
      </div>
      <div className="df-section-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorPill message={loadError} />

        {/* Two-step verification */}
        <div className="df-row" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
          <div>
            <div className="df-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <I.Shield size={13} /> Two-step verification
            </div>
            <div className="df-meta">
              {status
                ? status.enrolled
                  ? `On since ${status.enrolledAt ? when(status.enrolledAt) : 'your first sign-in'} · authenticator app`
                  : 'Not set up'
                : 'Loading…'}
            </div>
          </div>
          <span className={'df-pill ' + (status?.enrolled ? 'df-ok' : 'df-warn')}>{status?.enrolled ? 'On' : 'Off'}</span>
        </div>

        {/* Recovery codes */}
        <div className="df-row" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
          <div>
            <div className="df-name">Recovery codes</div>
            <div className="df-meta">
              {status ? `${left} of 10 unused` : 'Loading…'}
              {lowOnCodes && ' · running low, make a new set'}
              {' '}· each code signs you in once if you lose your phone
            </div>
          </div>
          {!regenerating && !newCodes && (
            <button className="df-btn df-sm" disabled={!status?.enrolled} onClick={() => { setRegenerating(true); setRegenError(null); }}>
              <I.Refresh size={12} /> New codes
            </button>
          )}
        </div>

        {regenerating && (
          <form onSubmit={regenerate} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
            <div className="df-muted" style={{ fontSize: 12 }}>
              Making new codes retires every old one. Confirm with a fresh code from your authenticator app.
            </div>
            <CodeInput value={code} onChange={setCode} autoFocus disabled={busy} />
            <ErrorPill message={regenError} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="df-btn df-sm df-primary" disabled={busy}>{busy ? 'Checking…' : 'Make new codes'}</button>
              <button type="button" className="df-btn df-sm df-ghost" disabled={busy} onClick={() => { setRegenerating(false); setCode(''); }}>Cancel</button>
            </div>
          </form>
        )}

        {newCodes && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 460 }}>
            <div style={{ fontSize: 12.5 }}>
              Your new recovery codes. <strong>They are shown only once</strong>; the old ones no longer work.
            </div>
            <RecoveryCodeList codes={newCodes} />
            <button type="button" className="df-btn df-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setNewCodes(null)}>
              <I.Check size={12} /> I saved them
            </button>
          </div>
        )}

        {/* Password */}
        <div className="df-row" style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}>
          <div>
            <div className="df-name">Password</div>
            <div className="df-meta">At least 12 characters · changing it signs out every other device</div>
          </div>
          {!changing && (
            <button className="df-btn df-sm" onClick={() => setChanging(true)}>Change password</button>
          )}
        </div>

        {changing && (
          <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="df-muted" style={{ fontSize: 11.5 }}>Current password</span>
              <input
                className="df-input"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={changeBusy}
                autoFocus
                required
              />
            </label>
            <NewPasswordFields password={newPassword} confirm={confirmPassword} onPassword={setNewPassword} onConfirm={setConfirmPassword} disabled={changeBusy} />
            <ErrorPill message={changeError} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="df-btn df-sm df-primary" disabled={changeBusy || !currentPassword || !passwordsReady(newPassword, confirmPassword)}>
                {changeBusy ? 'Saving…' : 'Change password'}
              </button>
              <button type="button" className="df-btn df-sm df-ghost" disabled={changeBusy} onClick={resetChangeForm}>Cancel</button>
            </div>
          </form>
        )}

        {/* Sessions */}
        <div>
          <div className="df-name" style={{ marginBottom: 6 }}>Where you're signed in</div>
          <div className="df-list">
            {sessions === null && !loadError && <div className="df-empty">Loading…</div>}
            {sessions?.map((s) => (
              <div key={s.id} className="df-row" style={{ gridTemplateColumns: '1fr auto' }}>
                <div>
                  <div className="df-name">
                    {describeAgent(s.userAgent)}
                    {s.current && <span className="df-pill df-ok" style={{ marginLeft: 8 }}>This device</span>}
                  </div>
                  <div className="df-meta">
                    {s.ip ? `${s.ip} · ` : ''}last active {when(s.lastSeenAt)} · signed in {when(s.createdAt)} · ends by {when(s.expiresAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="df-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
            Sessions end after 30 minutes without activity and 12 hours at most.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {confirmSignOut ? (
            <>
              <span style={{ fontSize: 12.5 }}>End every session, including this one?</span>
              <button className="df-btn df-sm df-primary" onClick={signOutEverywhere}>Yes, sign out everywhere</button>
              <button className="df-btn df-sm df-ghost" onClick={() => setConfirmSignOut(false)}>Keep me signed in</button>
            </>
          ) : (
            <button className="df-btn df-sm" onClick={() => setConfirmSignOut(true)}>Sign out everywhere</button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SecurityCard;
