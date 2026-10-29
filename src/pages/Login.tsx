import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { chooseFirm, getErrorMessage, type FirmChoice } from '@/utils/errors';
import { stagePath } from '@/utils/stage';
import { I } from '@/components/docflow/icons';
import '@/components/docflow/styles.css';

const DEV = import.meta.env.DEV;
const DEV_CREDS = {
  provider: { email: 'sarah@meridiancpa.com', password: 'password123' },
  client: { email: 'sarah.johnson@meridian.co', password: 'client123' },
};

type Kind = 'provider' | 'client';
const KIND_KEY = 'docflow.login.kind';

/**
 * Which side the form starts on. Clients outnumber the firm's own people by
 * dozens to one, so a first visit starts on Client — the 2026-10-28 audit found
 * clients who missed the toggle met a bare refusal. After that, whatever this
 * browser chose last; and a link into the advisor's screens means the advisor.
 */
function initialKind(from: string | undefined): Kind {
  if (from) return from.startsWith('/portal') ? 'client' : 'provider';
  try {
    const saved = window.localStorage.getItem(KIND_KEY);
    if (saved === 'provider' || saved === 'client') return saved;
  } catch {
    /* storage unavailable: fall through to the default */
  }
  return 'client';
}

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [kind, setKind] = useState<Kind>(() => initialKind((location.state as { from?: string } | null)?.from));
  const [email, setEmail] = useState(DEV ? DEV_CREDS[kind].email : '');
  const [password, setPassword] = useState(DEV ? DEV_CREDS[kind].password : '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /* Set when a client's password opened accounts at more than one firm (F7):
     the form gives way to "Which firm?" until they pick one or go back. */
  const [firms, setFirms] = useState<FirmChoice[] | null>(null);

  const setKindAndDefaults = (k: Kind) => {
    setKind(k);
    setError(null);
    setFirms(null);
    try {
      window.localStorage.setItem(KIND_KEY, k);
    } catch {
      /* a preference, not state: fine to lose */
    }
    if (DEV) {
      setEmail(DEV_CREDS[k].email);
      setPassword(DEV_CREDS[k].password);
    } else {
      setEmail('');
      setPassword('');
    }
  };

  const signIn = async (firmId?: string) => {
    setError(null);
    setLoading(true);
    try {
      const { me, stage } = await login(email, password, kind, firmId);
      try {
        window.localStorage.setItem(KIND_KEY, kind);
      } catch {
        /* a preference, not state: fine to lose */
      }
      const redirect = (location.state as { from?: string } | null)?.from;
      // The password is only the first step: the code (or enrollment) screen comes next,
      // and it forwards to `from` once the session is active.
      const owed = stagePath(stage);
      if (owed) {
        navigate(owed, { replace: true, state: redirect ? { from: redirect } : undefined });
      } else if (redirect) {
        navigate(redirect, { replace: true });
      } else if (me.kind === 'provider') {
        navigate('/', { replace: true });
      } else {
        navigate('/portal', { replace: true });
      }
    } catch (err) {
      const choices = chooseFirm(err);
      if (choices) setFirms(choices);
      else setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void signIn();
  };

  const back = () => {
    setFirms(null);
    setError(null);
  };

  return (
    <div className="df-root df-theme-sand" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div className="df-section" style={{ width: 400, maxWidth: '92vw', margin: 0 }}>
        <div className="df-section-head" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="df-brand-mark">D</div>
            <div>
              <div className="df-brand-name" style={{ fontSize: 16 }}>DocFlow</div>
              <div className="df-brand-sub">Sign in to continue</div>
            </div>
          </div>
        </div>
        <div className="df-section-body">
          <div className="df-seg" style={{ display: 'flex', marginBottom: 14 }}>
            <button
              className={kind === 'provider' ? 'df-active' : ''}
              onClick={() => setKindAndDefaults('provider')}
              style={{ flex: 1 }}
              type="button"
            >
              I work at the firm
            </button>
            <button
              className={kind === 'client' ? 'df-active' : ''}
              onClick={() => setKindAndDefaults('client')}
              style={{ flex: 1 }}
              type="button"
            >
              I’m a client
            </button>
          </div>

          {firms ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="df-small">
                <strong>Which firm?</strong> You have an account with more than one firm. Choose the one you are signing in to.
              </div>
              {firms.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className="df-btn"
                  style={{ justifyContent: 'center' }}
                  disabled={loading}
                  onClick={() => void signIn(f.id)}
                >
                  {f.name}
                </button>
              ))}
              {error && (
                <div
                  className="df-pill df-danger"
                  style={{ alignSelf: 'flex-start', padding: '4px 8px', fontSize: 11.5 }}
                >
                  {error}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <button type="button" className="df-link" style={{ fontSize: 11.5 }} onClick={back} disabled={loading}>
                  Back
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="df-muted" style={{ fontSize: 11.5 }}>Email</span>
                <input
                  className="df-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span className="df-muted" style={{ fontSize: 11.5 }}>Password</span>
                <input
                  className="df-input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>

              {error && (
                <div
                  className="df-pill df-danger"
                  style={{ alignSelf: 'flex-start', padding: '4px 8px', fontSize: 11.5 }}
                >
                  {error}
                </div>
              )}
              {error && (
                <div className="df-small df-muted">
                  {kind === 'provider'
                    ? 'Signing in to send documents to your accountant? Choose “I’m a client” above.'
                    : 'Work at the firm? Choose “I work at the firm” above.'}
                </div>
              )}

              <button
                type="submit"
                className="df-btn df-primary"
                style={{ justifyContent: 'center', marginTop: 4 }}
                disabled={loading}
              >
                {loading ? 'Signing in…' : (
                  <>
                    <I.Send size={13} /> Sign in as {kind === 'provider' ? 'advisor' : 'client'}
                  </>
                )}
              </button>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Link className="df-link" to="/forgot" style={{ fontSize: 11.5 }}>Forgot your password?</Link>
              </div>

              {DEV && (
                <div className="df-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Demo accounts pre-filled (dev only). Seeded credentials:{' '}
                  {kind === 'provider' ? (
                    <>provider <span className="df-mono">sarah@meridiancpa.com / password123</span></>
                  ) : (
                    <>client <span className="df-mono">sarah.johnson@meridian.co / client123</span></>
                  )}. Authenticator code: <span className="df-mono">npm run totp</span> in <span className="df-mono">server/</span> with the
                  secret <span className="df-mono">db:seed</span> printed.
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
